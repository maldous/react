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
import { loadTenantEncryptionKeyHex } from "../config/bootstrap-secrets.ts";
import type {
  TenantAdminCredential,
  TenantCredentialStore,
  CredentialLifecycle,
  CredentialMetadata,
} from "../ports/tenant-credential-store.ts";

const log = createLogger({ name: "tenant-credential-store" });

// Warn once at first use if the encryption key is absent.
let _warnedAboutMissingKey = false;

function getEncryptionKey(): Buffer | null {
  const keyHex = loadTenantEncryptionKeyHex();
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

export const postgresTenantCredentialStoreReliabilityEvidence = {
  provider: "postgres-tenant-credential-store",
  configSource:
    "Postgres pool is injected from process.env-backed POSTGRES_APP_URL/POSTGRES_URL configuration before adapter construction",
  secretSource:
    "client secrets enter only through setAuthSettingsCredential, are encrypted with TENANT_SECRET_ENCRYPTION_KEY, and metadata reads never select client_secret_enc",
  timeout:
    "tenant credential store operations are bounded by operationTimeoutMs through withOperationTimeout",
  retry:
    "credential lifecycle validation/retry is handled by the auth settings usecase; this adapter performs single Postgres writes and reads",
  degradedMode:
    "healthCheck returns degraded when tenant_auth_settings_credentials cannot be queried; credential reads return null on decrypt failure instead of exposing bad secret material",
  failClosed:
    "database errors throw, invalid ciphertext returns no credential, and missing production encryption key is enforced by bootstrap secret policy",
  fallbackRationale:
    "no alternate credential store fallback is attempted because Postgres is the configured credential persistence provider",
  healthCheck:
    "healthCheck probes public.tenant_auth_settings_credentials through the injected Postgres pool",
  operatorRecovery:
    "operators recover by repairing Postgres connectivity/migrations/TENANT_SECRET_ENCRYPTION_KEY state and rerunning proof:auth-credential-lifecycle",
  unavailableProof: "apps/platform-api/scripts/postgres-tenant-credential-store-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/scripts/postgres-tenant-credential-store-runtime-proof.ts",
} as const;

const DEFAULT_TENANT_CREDENTIAL_OPERATION_TIMEOUT_MS = 5000;

async function withOperationTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`postgres_tenant_credential_store_timeout:${operation}`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class PostgresTenantCredentialStore implements TenantCredentialStore {
  private readonly pool: PgPool;
  private readonly operationTimeoutMs: number;

  constructor(pool: PgPool, operationTimeoutMs = DEFAULT_TENANT_CREDENTIAL_OPERATION_TIMEOUT_MS) {
    this.pool = pool;
    this.operationTimeoutMs = operationTimeoutMs;
  }

  private execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return withOperationTimeout(operation, this.operationTimeoutMs, fn());
  }

  async getAuthSettingsCredential(organisationId: string): Promise<TenantAdminCredential | null> {
    const rows = await this.execute("getAuthSettingsCredential", () =>
      withSystemAdmin(this.pool as never, async (client) => {
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
      })
    );
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
    credential: TenantAdminCredential,
    lifecycle?: CredentialLifecycle
  ): Promise<void> {
    const encrypted = encryptSecret(credential.clientSecret);
    const validated = lifecycle?.validated ?? false;
    const rotatedBy = lifecycle?.rotatedBy ?? null;
    await this.execute("setAuthSettingsCredential", () =>
      withSystemAdmin(this.pool as never, async (client) => {
        await client.query(
          `INSERT INTO public.tenant_auth_settings_credentials
           (organisation_id, client_id, client_secret_enc,
            last_validated_at, last_rotated_at, rotated_by, validation_error_kind)
         VALUES ($1, $2, $3,
            CASE WHEN $4 THEN now() ELSE NULL END,
            now(), $5, NULL)
         ON CONFLICT (organisation_id) DO UPDATE SET
           client_id             = EXCLUDED.client_id,
           client_secret_enc     = EXCLUDED.client_secret_enc,
           updated_at            = now(),
           last_validated_at     = CASE WHEN $4 THEN now()
                                        ELSE public.tenant_auth_settings_credentials.last_validated_at END,
           last_rotated_at       = now(),
           rotated_by            = $5,
           validation_error_kind = NULL`,
          [organisationId, credential.clientId, encrypted, validated, rotatedBy]
        );
      })
    );
  }

  async getAuthSettingsCredentialMetadata(
    organisationId: string
  ): Promise<CredentialMetadata | null> {
    const rows = await this.execute("getAuthSettingsCredentialMetadata", () =>
      withSystemAdmin(this.pool as never, async (client) => {
        const result = await client.query<{
          client_id: string;
          created_at: string | null;
          updated_at: string | null;
          last_validated_at: string | null;
          last_rotated_at: string | null;
          rotated_by: string | null;
        }>(
          `SELECT client_id, created_at, updated_at,
                last_validated_at, last_rotated_at, rotated_by
           FROM public.tenant_auth_settings_credentials
          WHERE organisation_id = $1`,
          [organisationId]
        );
        return result.rows;
      })
    );
    if (!rows.length) return null;
    const row = rows[0]!;
    // Note: the secret column is deliberately NOT selected here.
    return {
      clientId: row.client_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastValidatedAt: row.last_validated_at,
      lastRotatedAt: row.last_rotated_at,
      rotatedBy: row.rotated_by,
    };
  }

  async healthCheck(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    try {
      await this.execute("healthCheck", () =>
        withSystemAdmin(this.pool as never, (client) =>
          client.query(
            "SELECT to_regclass('public.tenant_auth_settings_credentials') AS credentials_table"
          )
        )
      );
      return { status: "ready", detail: "postgres-tenant-credential-store:table:ok" };
    } catch (err) {
      return {
        status: "degraded",
        detail: `postgres-tenant-credential-store:${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
