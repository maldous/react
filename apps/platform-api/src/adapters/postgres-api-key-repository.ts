/**
 * PostgresApiKeyRepository (ADR-0065 / ADR-ACT-0257).
 *
 * Backed by public.api_keys (migration 025), RLS-enabled. Stores ONLY the hash +
 * salt + non-secret prefix; no method ever returns the secret or the hash to a
 * caller. Tenant self-list uses withTenant (RLS-scoped); create, operator list,
 * verification + last-used touch use withSystemAdmin (rls_bypass).
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { ApiKeyScope } from "@platform/contracts-admin";
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  ApiKeyVerificationRow,
  CreateApiKeyRecordInput,
} from "../ports/api-key-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

type DbTimestamp = Date | string | null;

interface Row {
  id: string;
  organisation_id: string;
  name: string;
  key_prefix: string;
  scopes: string[] | null;
  created_at: Date | string;
  created_by: string | null;
  last_used_at: DbTimestamp;
  expires_at: DbTimestamp;
  revoked_at: DbTimestamp;
}

function iso(v: DbTimestamp): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: Row): ApiKeyRecord {
  return {
    id: r.id,
    organisationId: r.organisation_id,
    name: r.name,
    keyPrefix: r.key_prefix,
    scopes: (r.scopes ?? []) as ApiKeyScope[],
    createdAt: iso(r.created_at) ?? "",
    createdBy: r.created_by,
    lastUsedAt: iso(r.last_used_at),
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
  };
}

const LIST_COLUMNS =
  "id, organisation_id, name, key_prefix, scopes, created_at, created_by, last_used_at, expires_at, revoked_at";

export class PostgresApiKeyRepository implements ApiKeyRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async create(input: CreateApiKeyRecordInput): Promise<ApiKeyRecord> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `INSERT INTO public.api_keys
           (organisation_id, name, key_prefix, key_hash, key_salt, scopes, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8::timestamptz)
         RETURNING ${LIST_COLUMNS}`,
        [
          input.organisationId,
          input.name,
          input.keyPrefix,
          input.keyHash,
          input.keySalt,
          input.scopes,
          input.createdBy,
          input.expiresAt ?? null,
        ]
      );
      return toRecord(r.rows[0] as Row);
    });
  }

  async listForTenant(organisationId: string): Promise<ApiKeyRecord[]> {
    return withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query(
        `SELECT ${LIST_COLUMNS} FROM public.api_keys ORDER BY created_at DESC`
      );
      return (r.rows as Row[]).map(toRecord);
    });
  }

  async listForTenantAsOperator(organisationId: string): Promise<ApiKeyRecord[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT ${LIST_COLUMNS} FROM public.api_keys WHERE organisation_id = $1 ORDER BY created_at DESC`,
        [organisationId]
      );
      return (r.rows as Row[]).map(toRecord);
    });
  }

  async revokeForTenant(organisationId: string, keyId: string): Promise<boolean> {
    return withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query(
        `UPDATE public.api_keys SET revoked_at = now()
          WHERE id = $1 AND revoked_at IS NULL`,
        [keyId]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async findVerificationByPrefix(keyPrefix: string): Promise<ApiKeyVerificationRow | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT id, organisation_id, key_hash, key_salt, scopes, revoked_at, expires_at
           FROM public.api_keys WHERE key_prefix = $1`,
        [keyPrefix]
      );
      const row = r.rows[0] as
        | {
            id: string;
            organisation_id: string;
            key_hash: string;
            key_salt: string;
            scopes: string[] | null;
            revoked_at: DbTimestamp;
            expires_at: DbTimestamp;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        organisationId: row.organisation_id,
        keyHash: row.key_hash,
        keySalt: row.key_salt,
        scopes: (row.scopes ?? []) as ApiKeyScope[],
        revokedAt: iso(row.revoked_at),
        expiresAt: iso(row.expires_at),
      };
    });
  }

  async touchLastUsed(keyId: string): Promise<void> {
    await withSystemAdmin(this.pool as never, async (client) => {
      await client.query(`UPDATE public.api_keys SET last_used_at = now() WHERE id = $1`, [keyId]);
    });
  }
}
