/**
 * PostgresTenantCredentialStore — Postgres-backed TenantCredentialStore.
 *
 * Stores client_id (plaintext) and client_secret (AES-256-GCM encrypted)
 * in public.tenant_auth_settings_credentials.
 *
 * Encryption key: TENANT_SECRET_ENCRYPTION_KEY env var (32-byte hex = 64 hex chars).
 * In development (key absent): stored with an "unenc:" prefix and a logged warning.
 * Production deployments MUST set TENANT_SECRET_ENCRYPTION_KEY.
 *
 * Encrypted value format stored in client_secret_enc:
 *   enc:<iv_hex>:<ciphertext_hex>:<tag_hex>   (AES-256-GCM, all components hex-encoded)
 *   unenc:<plaintext>                          (dev mode — key absent)
 *
 * Note: migration 009 comment incorrectly described the format as "base64".
 * The actual format is hex as documented here.
 *
 * Limitation: application-level AES defends against database dump exposure but
 * not against full app-server compromise. A KMS-backed solution is a future step.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createLogger } from "@platform/platform-logging";
import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  TenantAdminCredential,
  TenantCredentialStore,
} from "../ports/tenant-credential-store.ts";

const log = createLogger({ name: "tenant-credential-store" });

// Warn once at first use if the encryption key is absent.
let _warnedAboutMissingKey = false;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    log.warn("TENANT_SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes); ignoring");
    return null;
  }
  return Buffer.from(keyHex, "hex");
}

function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (!_warnedAboutMissingKey) {
      log.warn(
        "TENANT_SECRET_ENCRYPTION_KEY not set — tenant Auth Settings secrets stored unencrypted. " +
          "Set this variable in production."
      );
      _warnedAboutMissingKey = true;
    }
    return `unenc:${plaintext}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

function decryptSecret(stored: string): string {
  if (stored.startsWith("unenc:")) return stored.slice(6);
  if (!stored.startsWith("enc:")) throw new Error("tenant-credential-store: unknown format");

  const key = getEncryptionKey();
  if (!key)
    throw new Error("tenant-credential-store: TENANT_SECRET_ENCRYPTION_KEY required to decrypt");

  const parts = stored.slice(4).split(":");
  if (parts.length !== 3) throw new Error("tenant-credential-store: malformed ciphertext");
  const [ivHex, ctHex, tagHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

export class PostgresTenantCredentialStore implements TenantCredentialStore {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async getAuthSettingsCredential(organisationId: string): Promise<TenantAdminCredential | null> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const result = await client.query<{
        client_id: string;
        client_secret_enc: string;
      }>(
        `SELECT client_id, client_secret_enc
           FROM public.tenant_auth_settings_credentials
          WHERE organisation_id = $1`,
        [organisationId]
      );
      return result.rows;
    });
    if (!rows.length) return null;
    const row = rows[0]!;
    try {
      return {
        clientId: row.client_id,
        clientSecret: decryptSecret(row.client_secret_enc),
      };
    } catch (err) {
      log.error({ organisationId, err }, "tenant-credential-store: failed to decrypt secret");
      return null;
    }
  }

  async setAuthSettingsCredential(
    organisationId: string,
    credential: TenantAdminCredential
  ): Promise<void> {
    const encrypted = encryptSecret(credential.clientSecret);
    await withSystemAdmin(this.pool as never, async (client) => {
      await client.query(
        `INSERT INTO public.tenant_auth_settings_credentials
           (organisation_id, client_id, client_secret_enc)
         VALUES ($1, $2, $3)
         ON CONFLICT (organisation_id) DO UPDATE SET
           client_id         = EXCLUDED.client_id,
           client_secret_enc = EXCLUDED.client_secret_enc,
           updated_at        = now()`,
        [organisationId, credential.clientId, encrypted]
      );
    });
  }
}
