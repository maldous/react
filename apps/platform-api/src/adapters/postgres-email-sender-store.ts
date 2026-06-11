/**
 * PostgresEmailSenderSecretStore (ADR-0047) — Postgres-backed, AES-256-GCM
 * encrypted store for the tenant email sender secret (SMTP password / API key).
 * Stored in public.tenant_email_sender_credentials (migration 018), accessed via
 * withSystemAdmin() (rls_bypass) — platform-managed infrastructure secret, not
 * tenant user data. The secret column is never selected in metadata reads.
 */

import { createLogger } from "@platform/platform-logging";
import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  EmailSenderSecretMetadata,
  EmailSenderSecretStore,
} from "../ports/email-sender-store.ts";
import { decryptTenantSecret, encryptTenantSecret } from "./tenant-secret-crypto.ts";

const log = createLogger({ name: "email-sender-store" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

export class PostgresEmailSenderSecretStore implements EmailSenderSecretStore {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async getSecret(organisationId: string): Promise<string | null> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const result = await client.query<{ secret_enc: string }>(
        `SELECT secret_enc FROM public.tenant_email_sender_credentials WHERE organisation_id = $1`,
        [organisationId]
      );
      return result.rows;
    });
    if (!rows.length) return null;
    try {
      return decryptTenantSecret(rows[0]!.secret_enc);
    } catch (err) {
      log.error({ organisationId, err }, "email-sender-store: failed to decrypt secret");
      return null;
    }
  }

  async setSecret(
    organisationId: string,
    secret: string,
    opts?: { validated?: boolean; rotatedBy?: string }
  ): Promise<void> {
    const encrypted = encryptTenantSecret(secret);
    const validated = opts?.validated ?? false;
    const rotatedBy = opts?.rotatedBy ?? null;
    await withSystemAdmin(this.pool as never, async (client) => {
      await client.query(
        `INSERT INTO public.tenant_email_sender_credentials
           (organisation_id, secret_enc, last_validated_at, rotated_by)
         VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, $4)
         ON CONFLICT (organisation_id) DO UPDATE SET
           secret_enc        = EXCLUDED.secret_enc,
           updated_at        = now(),
           last_validated_at = CASE WHEN $3 THEN now()
                                    ELSE public.tenant_email_sender_credentials.last_validated_at END,
           rotated_by        = $4`,
        [organisationId, encrypted, validated, rotatedBy]
      );
    });
  }

  async markValidated(organisationId: string): Promise<void> {
    await withSystemAdmin(this.pool as never, async (client) => {
      await client.query(
        `UPDATE public.tenant_email_sender_credentials
            SET last_validated_at = now(), updated_at = now()
          WHERE organisation_id = $1`,
        [organisationId]
      );
    });
  }

  async getMetadata(organisationId: string): Promise<EmailSenderSecretMetadata | null> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const result = await client.query<{
        updated_at: string | null;
        last_validated_at: string | null;
      }>(
        `SELECT updated_at, last_validated_at
           FROM public.tenant_email_sender_credentials WHERE organisation_id = $1`,
        [organisationId]
      );
      return result.rows;
    });
    if (!rows.length) return { hasCredential: false, lastValidatedAt: null, updatedAt: null };
    return {
      hasCredential: true,
      lastValidatedAt: rows[0]!.last_validated_at,
      updatedAt: rows[0]!.updated_at,
    };
  }

  async clear(organisationId: string): Promise<void> {
    await withSystemAdmin(this.pool as never, async (client) => {
      await client.query(
        `DELETE FROM public.tenant_email_sender_credentials WHERE organisation_id = $1`,
        [organisationId]
      );
    });
  }
}
