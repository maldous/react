/**
 * PostgresDelegatedAdminRoles (ADR-0063 / V1C-04).
 *
 * Backed by public.delegated_admin_roles (migration 037). RLS-enabled; tenancy
 * isolation is enforced at the database layer (current_setting('app.current_tenant_id')).
 *
 * Auth contexts per operation:
 *   - grantDelegation()  → withSystemAdmin (rls_bypass). The usecase has
 *     already validated grantor authority + tenant scoping; persistence does
 *     not duplicate.
 *   - revokeDelegation() → withSystemAdmin (rls_bypass). Same rationale.
 *   - listForTenant()    → withTenant (RLS-scoped).
 *   - listActiveForGrantee() → withSystemAdmin (rls_bypass). Caller is the
 *     authorisation hot-path; tenant context is enforced at the upstream
 *     layer.
 *   - findActiveForGranteeAndScope() → withSystemAdmin (rls_bypass). Same
 *     rationale as listActiveForGrantee().
 *
 * Soft-delete via revoked_at column (set on revoke). expires_at <= now() and
 * revoked_at IS NOT NULL are both treated as inactive by the adapter's
 * "active" filter (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())).
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  DelegatedRole,
  DelegatedAdminRolesPort,
  GrantDelegationInput,
} from "../ports/delegated-admin-roles.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresDelegatedAdminRolesProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

type DbTimestamp = Date | string | null;

interface Row {
  id: string;
  organisation_id: string;
  granter_user_id: string;
  grantee_user_id: string;
  scope: string;
  granted_at: Date | string;
  granted_by: string;
  expires_at: DbTimestamp;
  revoked_at: DbTimestamp;
  revoked_by: string | null; // TEXT — Keycloak user id, not a timestamp
}

const LIST_COLUMNS =
  "id, organisation_id, granter_user_id, grantee_user_id, scope, " +
  "granted_at, granted_by, expires_at, revoked_at, revoked_by";

const ACTIVE_PREDICATE = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())";

function iso(v: DbTimestamp): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: Row): DelegatedRole {
  return {
    id: r.id,
    organisationId: r.organisation_id,
    granterUserId: r.granter_user_id,
    granteeUserId: r.grantee_user_id,
    scope: r.scope,
    grantedAt: iso(r.granted_at) ?? "",
    grantedBy: r.granted_by,
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
    // revoked_by is a TEXT column (Keycloak user id), not a timestamp.
    // Direct mapping: the Row type already carries string | null.
    revokedBy: r.revoked_by,
  };
}

export function loadPostgresDelegatedAdminRolesProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresDelegatedAdminRolesProviderConfig {
  return {
    statementTimeoutMs: Number(env["DELEGATED_ADMIN_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["DELEGATED_ADMIN_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["DELEGATED_ADMIN_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresDelegatedAdminRoles implements DelegatedAdminRolesPort {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresDelegatedAdminRolesProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresDelegatedAdminRolesProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresDelegatedAdminRolesProviderConfig(),
      ...config,
    };
  }

  async grantDelegation(input: GrantDelegationInput): Promise<DelegatedRole> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `INSERT INTO public.delegated_admin_roles
           (organisation_id, granter_user_id, grantee_user_id, scope,
            granted_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
         RETURNING ${LIST_COLUMNS}`,
          [
            input.organisationId,
            input.granterUserId,
            input.granteeUserId,
            input.scope,
            input.grantedBy,
            input.expiresAt,
          ]
        );
        const row = r.rows[0] as Row | undefined;
        if (!row) throw new Error("grantDelegation: INSERT RETURNING produced no row");
        return toRecord(row);
      })
    );
  }

  async revokeDelegation(delegationId: string, revokedBy: string): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `UPDATE public.delegated_admin_roles
            SET revoked_at = now(),
                revoked_by = $2
          WHERE id = $1
            AND revoked_at IS NULL`,
          [delegationId, revokedBy]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async listForTenant(organisationId: string): Promise<DelegatedRole[]> {
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `SELECT ${LIST_COLUMNS}
           FROM public.delegated_admin_roles
          ORDER BY granted_at DESC`
        );
        return (r.rows as Row[]).map(toRecord);
      })
    );
  }

  async listActiveForGrantee(granteeUserId: string): Promise<DelegatedRole[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `SELECT ${LIST_COLUMNS}
           FROM public.delegated_admin_roles
          WHERE grantee_user_id = $1
            AND ${ACTIVE_PREDICATE}
          ORDER BY granted_at DESC`,
          [granteeUserId]
        );
        return (r.rows as Row[]).map(toRecord);
      })
    );
  }

  async findActiveForGranteeAndScope(
    granteeUserId: string,
    scope: string
  ): Promise<DelegatedRole | null> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `SELECT ${LIST_COLUMNS}
           FROM public.delegated_admin_roles
          WHERE grantee_user_id = $1
            AND scope = $2
            AND ${ACTIVE_PREDICATE}
          ORDER BY granted_at DESC
          LIMIT 1`,
          [granteeUserId, scope]
        );
        const row = r.rows[0] as Row | undefined;
        return row ? toRecord(row) : null;
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-delegated-admin-roles" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'delegated_admin_roles'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-delegated-admin-roles" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 037-delegated-admin-roles.sql, inspect delegated_admin_roles RLS/grants and rls_bypass role, then retry delegated-admin grant or revoke";
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.providerConfig.retryAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt >= this.providerConfig.retryAttempts) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.providerConfig.retryBackoffMs * (attempt + 1))
        );
      }
    }
    throw new Error(
      `postgres-delegated-admin-roles unavailable; no fallback is allowed for delegated administrator grants, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
