/**
 * PostgresSecretStore (ADR-0069 / ADR-ACT-0265) — built-in, durable, default.
 *
 * Backed by public.secret_refs (migration 031), RLS-enabled. The VALUE is stored
 * AES-256-GCM encrypted at rest (ADR-0047 tenant-secret-crypto: `enc:…`, or `unenc:…`
 * in dev when no key is set). The opaque `secret:<uuid>` ref is the only handle a
 * caller ever holds; metadata/list never decrypt. `resolve()` is the server-internal
 * value read (decrypts) and returns null for unknown/revoked refs.
 *
 * Tenant isolation: every query is scoped by organisation_id AND runs under RLS, so a
 * ref minted for tenant A is invisible to tenant B even with the raw uuid. Writes +
 * value reads use withSystemAdmin (rls_bypass) but always carry an explicit
 * organisation_id predicate — the two layers are belt-and-braces.
 */

import { randomUUID } from "node:crypto";
import { withSystemAdmin } from "@platform/adapters-postgres";
import { encryptTenantSecret, decryptTenantSecret } from "./tenant-secret-crypto.ts";
import type {
  PutSecretInput,
  SecretMetadata,
  SecretStore,
  SecretStoreReadiness,
} from "../ports/secret-store.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

type DbTimestamp = Date | string | null;

interface MetaRow {
  ref: string;
  secret_name: string;
  provider: "builtin" | "openbao";
  version: number;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
  revoked_at: DbTimestamp;
}

function iso(v: DbTimestamp): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toMeta(r: MetaRow): SecretMetadata {
  return {
    ref: r.ref,
    name: r.secret_name,
    provider: r.provider,
    version: Number(r.version),
    revoked: r.revoked_at != null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    revokedAt: iso(r.revoked_at),
  };
}

const META_COLUMNS = "ref, secret_name, provider, version, created_at, updated_at, revoked_at";

export class PostgresSecretStore implements SecretStore {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async put(input: PutSecretInput): Promise<SecretMetadata> {
    const encrypted = encryptTenantSecret(input.value);
    return withSystemAdmin(this.pool as never, async (client) => {
      // Rotate-in-place if the name already exists (bump version, clear revoke); else mint a new ref.
      const existing = await client.query<{ ref: string }>(
        "SELECT ref FROM public.secret_refs WHERE organisation_id = $1 AND secret_name = $2",
        [input.organisationId, input.name]
      );
      if (existing.rows[0]) {
        const r = await client.query<MetaRow>(
          `UPDATE public.secret_refs
             SET encrypted_value = $3, provider = 'builtin', backend_path = NULL,
                 version = version + 1, revoked_at = NULL, revoked_by = NULL,
                 updated_at = now(), created_by = COALESCE(created_by, $4)
           WHERE organisation_id = $1 AND secret_name = $2
           RETURNING ${META_COLUMNS}`,
          [input.organisationId, input.name, encrypted, input.actorId]
        );
        return toMeta(r.rows[0]!);
      }
      const ref = `secret:${randomUUID()}`;
      const r = await client.query<MetaRow>(
        `INSERT INTO public.secret_refs
           (organisation_id, ref, secret_name, provider, encrypted_value, created_by)
         VALUES ($1, $2, $3, 'builtin', $4, $5)
         RETURNING ${META_COLUMNS}`,
        [input.organisationId, ref, input.name, encrypted, input.actorId]
      );
      return toMeta(r.rows[0]!);
    });
  }

  async getMetadata(organisationId: string, ref: string): Promise<SecretMetadata | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<MetaRow>(
        `SELECT ${META_COLUMNS} FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2`,
        [organisationId, ref]
      );
      return r.rows[0] ? toMeta(r.rows[0]) : null;
    });
  }

  async list(organisationId: string): Promise<SecretMetadata[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<MetaRow>(
        `SELECT ${META_COLUMNS} FROM public.secret_refs WHERE organisation_id = $1 ORDER BY secret_name`,
        [organisationId]
      );
      return r.rows.map(toMeta);
    });
  }

  async resolve(organisationId: string, ref: string): Promise<string | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<{ encrypted_value: string | null; revoked_at: Date | null }>(
        "SELECT encrypted_value, revoked_at FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2 AND provider = 'builtin'",
        [organisationId, ref]
      );
      const row = r.rows[0];
      if (!row || row.revoked_at != null || row.encrypted_value == null) return null;
      return decryptTenantSecret(row.encrypted_value);
    });
  }

  async revoke(organisationId: string, ref: string, actorId: string): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.secret_refs SET revoked_at = now(), revoked_by = $3, updated_at = now()
           WHERE organisation_id = $1 AND ref = $2 AND revoked_at IS NULL`,
        [organisationId, ref, actorId]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async delete(organisationId: string, ref: string, _actorId: string): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        "DELETE FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2",
        [organisationId, ref]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  // The built-in store is durable Postgres; readiness follows the relational store.
  async readiness(): Promise<SecretStoreReadiness> {
    try {
      await withSystemAdmin(this.pool as never, (client) => client.query("SELECT 1"));
      return { provider: "builtin", status: "ready", detail: "postgres secret store reachable" };
    } catch {
      return { provider: "builtin", status: "degraded", detail: "postgres unreachable" };
    }
  }
}
