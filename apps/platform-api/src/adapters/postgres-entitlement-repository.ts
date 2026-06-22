/**
 * PostgresEntitlementRepository (ADR-0057 / ADR-0058 / ADR-ACT-0254).
 *
 * Backed by public.tenant_entitlements (migration 022), RLS-enabled.
 *   - listForTenant() uses withTenant() so the tenant only ever sees its own rows
 *     (RLS predicate on app.current_tenant_id) — defence-in-depth for the self-read.
 *   - listForTenantAsOperator()/getGrant()/upsert() use withSystemAdmin() (rls_bypass)
 *     for cross-tenant operator administration. Every operator mutation is audited
 *     at the usecase layer BEFORE upsert() is called.
 * No secrets are stored here; metadata is operator-supplied JSON (notes), never secret.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
  UpsertEntitlementInput,
} from "../ports/entitlement-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresEntitlementProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

interface Row {
  organisation_id: string;
  entitlement_key: string;
  state: "granted" | "revoked";
  source: "system" | "migration" | "seed";
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
  updated_by: string | null;
}

function toRecord(row: Row): EntitlementGrantRecord {
  return {
    organisationId: row.organisation_id,
    entitlementKey: row.entitlement_key,
    state: row.state,
    source: row.source,
    metadata: row.metadata ?? {},
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const SELECT_COLS = `organisation_id, entitlement_key, state, source, metadata, updated_at, updated_by`;

export function loadPostgresEntitlementProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresEntitlementProviderConfig {
  return {
    statementTimeoutMs: Number(env["ENTITLEMENT_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["ENTITLEMENT_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["ENTITLEMENT_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresEntitlementRepository implements EntitlementRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresEntitlementProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresEntitlementProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresEntitlementProviderConfig(),
      ...config,
    };
  }

  async listForTenant(organisationId: string): Promise<EntitlementGrantRecord[]> {
    const rows = await this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const result = await client.query<Row>(
          `SELECT ${SELECT_COLS} FROM public.tenant_entitlements WHERE organisation_id = $1 ORDER BY entitlement_key`,
          [organisationId]
        );
        return result.rows;
      })
    );
    return rows.map(toRecord);
  }

  async listForTenantAsOperator(organisationId: string): Promise<EntitlementGrantRecord[]> {
    const rows = await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const result = await client.query<Row>(
          `SELECT ${SELECT_COLS} FROM public.tenant_entitlements WHERE organisation_id = $1 ORDER BY entitlement_key`,
          [organisationId]
        );
        return result.rows;
      })
    );
    return rows.map(toRecord);
  }

  async getGrant(
    organisationId: string,
    entitlementKey: string
  ): Promise<EntitlementGrantRecord | null> {
    const rows = await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const result = await client.query<Row>(
          `SELECT ${SELECT_COLS} FROM public.tenant_entitlements WHERE organisation_id = $1 AND entitlement_key = $2`,
          [organisationId, entitlementKey]
        );
        return result.rows;
      })
    );
    return rows.length ? toRecord(rows[0]!) : null;
  }

  async upsert(input: UpsertEntitlementInput): Promise<EntitlementGrantRecord> {
    const metadata = JSON.stringify(input.metadata ?? {});
    const rows = await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const result = await client.query<Row>(
          `INSERT INTO public.tenant_entitlements
           (organisation_id, entitlement_key, state, source, metadata, updated_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (organisation_id, entitlement_key) DO UPDATE SET
           state      = EXCLUDED.state,
           source     = EXCLUDED.source,
           metadata   = EXCLUDED.metadata,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
         RETURNING ${SELECT_COLS}`,
          [
            input.organisationId,
            input.entitlementKey,
            input.state,
            input.source,
            metadata,
            input.updatedBy,
          ]
        );
        return result.rows;
      })
    );
    return toRecord(rows[0]!);
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-entitlement-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'tenant_entitlements'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-entitlement-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 022-tenant-entitlements.sql, inspect tenant_entitlements RLS/grants and rls_bypass role membership, then retry entitlement grant/revoke";
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
      `postgres-entitlement-repository unavailable; no fallback is allowed for entitlement authorization decisions, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
