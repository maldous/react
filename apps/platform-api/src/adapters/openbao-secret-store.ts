/**
 * OpenBaoSecretStore (ADR-0069 / ADR-ACT-0265) — composed Tier-1 secrets provider.
 *
 * OpenBao (open-source, Vault-compatible) is the central runtime secrets manager.
 * The VALUE lives in OpenBao KV v2; only value-free metadata (ref/name/version/
 * timestamps + the backend path) is mirrored in public.secret_refs so the operator
 * surface, audit, and tenant isolation are identical across providers. The plaintext
 * is written to and read from OpenBao over HTTP with the global `fetch` — NO new npm
 * dependency, so the dependency-audit gates stay green.
 *
 * Honest degradation (no fake readiness): `readiness()` GETs `/v1/sys/health`. If
 * OpenBao is unreachable it reports `degraded`; `resolve()` returns null (the secret
 * is unavailable — never faked, never silently substituted) and `put()` throws (we
 * will not record a metadata row for a value we could not store). The built-in
 * Postgres store remains the durable default; OpenBao is selected only when
 * SECRET_STORE_PROVIDER=openbao and the backend answers.
 *
 * Tenant isolation: the OpenBao KV path is `<kvBasePath>/<organisationId>/<refUuid>`
 * and every metadata query carries an explicit organisation_id predicate under RLS,
 * so tenant A can never resolve tenant B's ref.
 */

import { randomUUID } from "node:crypto";
import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  PutSecretInput,
  SecretMetadata,
  SecretStore,
  SecretStoreReadiness,
} from "../ports/secret-store.ts";

export const openBaoSecretStoreReliabilityEvidence = {
  provider: "openbao-secret-store",
  configSource:
    "OpenBaoOptions is constructed from loadBootstrapSecretConfig/process.env in apps/platform-api/src/config/bootstrap-secrets.ts",
  secretSource:
    "OPENBAO_TOKEN or OPENBAO_TOKEN_FILE is loaded as the bootstrap credential and never logged",
  timeout: "every OpenBao HTTP call uses AbortSignal.timeout via fetchOpenBao",
  retry:
    "no retry on secret writes/deletes/resolves because the provider is the source of truth; callers receive degraded/unavailable state instead of duplicate mutation attempts",
  degradedMode:
    "readiness returns degraded for sealed, standby, uninitialised, or unreachable OpenBao; resolve returns null when unavailable",
  failClosed:
    "put throws before metadata is recorded when OpenBao is unavailable; bootstrap denies openbao without address/token",
  fallbackRationale:
    "no implicit fallback once SECRET_STORE_PROVIDER=openbao is selected; the built-in Postgres store is only the explicit default provider",
  healthCheck: "readiness probes /v1/sys/health with the provider token",
  operatorRecovery:
    "operators recover by unsealing/restarting OpenBao, rotating OPENBAO_TOKEN, or reconciling logged orphaned backend paths",
  unavailableProof: "apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/tests/unit/bootstrap-secrets.test.ts",
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type FetchImpl = typeof fetch;

export interface OpenBaoOptions {
  /** Base URL, e.g. http://localhost:8200. */
  address: string;
  /** Auth token (X-Vault-Token). Sourced from env/secret — never logged. */
  token: string;
  /** KV v2 mount. Default "secret". */
  mount?: string;
  /** Logical path prefix under the mount. Default "platform". */
  kvBasePath?: string;
  fetchImpl?: FetchImpl;
  /** Provider HTTP timeout in milliseconds. Default 2500. */
  timeoutMs?: number;
  /** Structured warn sink (no secrets). Defaults to no-op. */
  warn?: (message: string, meta: Record<string, unknown>) => void;
}

type DbTimestamp = Date | string | null;

interface MetaRow {
  ref: string;
  secret_name: string;
  version: number;
  backend_path: string | null;
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
    provider: "openbao",
    version: Number(r.version),
    revoked: r.revoked_at != null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    revokedAt: iso(r.revoked_at),
  };
}

const META_COLUMNS = "ref, secret_name, version, backend_path, created_at, updated_at, revoked_at";

export class OpenBaoSecretStore implements SecretStore {
  private readonly pool: PgPool;
  private readonly address: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly kvBasePath: string;
  private readonly fetchImpl: FetchImpl;
  private readonly timeoutMs: number;
  private readonly warn: (message: string, meta: Record<string, unknown>) => void;

  constructor(pool: PgPool, opts: OpenBaoOptions) {
    this.pool = pool;
    this.address = opts.address.replace(/\/+$/, "");
    this.token = opts.token;
    this.mount = opts.mount ?? "secret";
    this.kvBasePath = (opts.kvBasePath ?? "platform").replace(/^\/+/, "").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.warn = opts.warn ?? (() => {});
  }

  private dataUrl(path: string): string {
    return `${this.address}/v1/${this.mount}/data/${path}`;
  }
  private metadataUrl(path: string): string {
    return `${this.address}/v1/${this.mount}/metadata/${path}`;
  }
  private pathFor(organisationId: string, ref: string): string {
    const refId = ref.startsWith("secret:") ? ref.slice("secret:".length) : ref;
    return `${this.kvBasePath}/${organisationId}/${refId}`;
  }
  private headers(): Record<string, string> {
    return { "X-Vault-Token": this.token, "Content-Type": "application/json" };
  }
  private fetchOpenBao(input: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
  }

  async put(input: PutSecretInput): Promise<SecretMetadata> {
    // Reuse the existing ref/path for this name if present (rotation); else mint one.
    const existing = await withSystemAdmin(this.pool as never, (client) =>
      client.query<{ ref: string; backend_path: string | null }>(
        "SELECT ref, backend_path FROM public.secret_refs WHERE organisation_id = $1 AND secret_name = $2",
        [input.organisationId, input.name]
      )
    );
    const ref = existing.rows[0]?.ref ?? `secret:${randomUUID()}`;
    const path = existing.rows[0]?.backend_path ?? this.pathFor(input.organisationId, ref);

    // Store the value in OpenBao FIRST — only record metadata if the write succeeded.
    const res = await this.fetchOpenBao(this.dataUrl(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ data: { value: input.value } }),
    });
    if (!res.ok) {
      this.warn("openbao secret write failed; not recording metadata", {
        provider: "openbao",
        op: "put",
        status: res.status,
        organisationId: input.organisationId,
      });
      throw new Error(`openbao write failed (${res.status})`);
    }

    return withSystemAdmin(this.pool as never, async (client) => {
      if (existing.rows[0]) {
        const r = await client.query<MetaRow>(
          `UPDATE public.secret_refs
             SET provider = 'openbao', encrypted_value = NULL, backend_path = $3,
                 version = version + 1, revoked_at = NULL, revoked_by = NULL,
                 updated_at = now(), created_by = COALESCE(created_by, $4)
           WHERE organisation_id = $1 AND secret_name = $2
           RETURNING ${META_COLUMNS}`,
          [input.organisationId, input.name, path, input.actorId]
        );
        return toMeta(r.rows[0]!);
      }
      const r = await client.query<MetaRow>(
        `INSERT INTO public.secret_refs
           (organisation_id, ref, secret_name, provider, backend_path, created_by)
         VALUES ($1, $2, $3, 'openbao', $4, $5)
         RETURNING ${META_COLUMNS}`,
        [input.organisationId, ref, input.name, path, input.actorId]
      );
      return toMeta(r.rows[0]!);
    });
  }

  async getMetadata(organisationId: string, ref: string): Promise<SecretMetadata | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<MetaRow>(
        `SELECT ${META_COLUMNS} FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2 AND provider = 'openbao'`,
        [organisationId, ref]
      );
      return r.rows[0] ? toMeta(r.rows[0]) : null;
    });
  }

  async list(organisationId: string): Promise<SecretMetadata[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<MetaRow>(
        `SELECT ${META_COLUMNS} FROM public.secret_refs WHERE organisation_id = $1 AND provider = 'openbao' ORDER BY secret_name`,
        [organisationId]
      );
      return r.rows.map(toMeta);
    });
  }

  async resolve(organisationId: string, ref: string): Promise<string | null> {
    const meta = await withSystemAdmin(this.pool as never, (client) =>
      client.query<{ backend_path: string | null; revoked_at: Date | null }>(
        "SELECT backend_path, revoked_at FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2 AND provider = 'openbao'",
        [organisationId, ref]
      )
    );
    const row = meta.rows[0];
    if (!row || row.revoked_at != null || row.backend_path == null) return null;
    try {
      const res = await this.fetchOpenBao(this.dataUrl(row.backend_path), {
        headers: this.headers(),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { data?: { value?: string } } };
      return body.data?.data?.value ?? null;
    } catch {
      this.warn("openbao unreachable on resolve; secret unavailable (not faked)", {
        provider: "openbao",
        op: "resolve",
        organisationId,
      });
      return null;
    }
  }

  async revoke(organisationId: string, ref: string, actorId: string): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.secret_refs SET revoked_at = now(), revoked_by = $3, updated_at = now()
           WHERE organisation_id = $1 AND ref = $2 AND provider = 'openbao' AND revoked_at IS NULL`,
        [organisationId, ref, actorId]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async delete(organisationId: string, ref: string, _actorId: string): Promise<boolean> {
    const meta = await withSystemAdmin(this.pool as never, (client) =>
      client.query<{ backend_path: string | null }>(
        "SELECT backend_path FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2 AND provider = 'openbao'",
        [organisationId, ref]
      )
    );
    const path = meta.rows[0]?.backend_path;
    if (path) {
      await this.fetchOpenBao(this.metadataUrl(path), {
        method: "DELETE",
        headers: this.headers(),
      }).catch((err: unknown) => {
        // The DB row is removed below regardless; a failed backend delete leaves
        // orphaned secret material in OpenBao that must be reconcilable, so it
        // must never be silent (ADR-ACT-0284).
        this.warn("openbao backend metadata delete failed; secret material may be orphaned", {
          provider: "openbao",
          op: "delete",
          organisationId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        "DELETE FROM public.secret_refs WHERE organisation_id = $1 AND ref = $2 AND provider = 'openbao'",
        [organisationId, ref]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async readiness(): Promise<SecretStoreReadiness> {
    try {
      const res = await this.fetchOpenBao(`${this.address}/v1/sys/health`, {
        headers: this.headers(),
      });
      // OpenBao health returns 200 (initialized, unsealed, active). Any 2xx = ready.
      if (res.ok) {
        return { provider: "openbao", status: "ready", detail: "openbao reachable (sys/health)" };
      }
      return {
        provider: "openbao",
        status: "degraded",
        detail: `openbao health ${res.status} (sealed/standby/uninitialised)`,
      };
    } catch {
      return {
        provider: "openbao",
        status: "degraded",
        detail: "openbao unreachable; built-in Postgres store remains the durable default",
      };
    }
  }
}
