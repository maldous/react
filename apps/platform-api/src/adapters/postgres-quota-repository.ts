/**
 * PostgresQuotaRepository (ADR-0067 / ADR-ACT-0256).
 *
 * Backed by public.tenant_quotas (migration 024), RLS-enabled. Tenant self-reads
 * (listForTenant / getByKey for enforcement) use withTenant (RLS-scoped); operator
 * reads/writes use withSystemAdmin (rls_bypass). `window` is stored as window_kind
 * (a reserved SQL keyword) and mapped to `window` here. No secret fields.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { QuotaAction, QuotaWindow } from "@platform/contracts-admin";
import type { QuotaRecord, QuotaRepository, UpsertQuotaInput } from "../ports/quota-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresQuotaProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

interface Row {
  organisation_id: string;
  quota_key: string;
  entitlement_key: string;
  meter_key: string;
  limit_value: string;
  window_kind: QuotaWindow;
  action: QuotaAction;
  updated_at: string | null;
  updated_by: string | null;
}

function toRecord(row: Row): QuotaRecord {
  return {
    organisationId: row.organisation_id,
    quotaKey: row.quota_key,
    entitlementKey: row.entitlement_key,
    meterKey: row.meter_key,
    limit: Number(row.limit_value),
    window: row.window_kind,
    action: row.action,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const COLS = `organisation_id, quota_key, entitlement_key, meter_key, limit_value, window_kind, action, updated_at, updated_by`;

export function loadPostgresQuotaProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresQuotaProviderConfig {
  return {
    statementTimeoutMs: Number(env["QUOTA_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["QUOTA_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["QUOTA_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresQuotaRepository implements QuotaRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresQuotaProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresQuotaProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresQuotaProviderConfig(),
      ...config,
    };
  }

  async listForTenant(organisationId: string): Promise<QuotaRecord[]> {
    const rows = await this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLS} FROM public.tenant_quotas WHERE organisation_id = $1 ORDER BY quota_key`,
          [organisationId]
        );
        return r.rows;
      })
    );
    return rows.map(toRecord);
  }

  async listForTenantAsOperator(organisationId: string): Promise<QuotaRecord[]> {
    const rows = await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLS} FROM public.tenant_quotas WHERE organisation_id = $1 ORDER BY quota_key`,
          [organisationId]
        );
        return r.rows;
      })
    );
    return rows.map(toRecord);
  }

  async getByKey(organisationId: string, quotaKey: string): Promise<QuotaRecord | null> {
    const rows = await this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLS} FROM public.tenant_quotas WHERE organisation_id = $1 AND quota_key = $2`,
          [organisationId, quotaKey]
        );
        return r.rows;
      })
    );
    return rows.length ? toRecord(rows[0]!) : null;
  }

  async upsert(input: UpsertQuotaInput): Promise<QuotaRecord> {
    const rows = await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `INSERT INTO public.tenant_quotas
           (organisation_id, quota_key, entitlement_key, meter_key, limit_value, window_kind, action, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (organisation_id, quota_key) DO UPDATE SET
           entitlement_key = EXCLUDED.entitlement_key,
           meter_key       = EXCLUDED.meter_key,
           limit_value     = EXCLUDED.limit_value,
           window_kind     = EXCLUDED.window_kind,
           action          = EXCLUDED.action,
           updated_at      = now(),
           updated_by      = EXCLUDED.updated_by
         RETURNING ${COLS}`,
          [
            input.organisationId,
            input.quotaKey,
            input.entitlementKey,
            input.meterKey,
            input.limit,
            input.window,
            input.action,
            input.updatedBy,
          ]
        );
        return r.rows;
      })
    );
    return toRecord(rows[0]!);
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-quota-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'tenant_quotas'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-quota-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 024-metering-and-quotas.sql, inspect tenant_quotas RLS/grants and quota keys, then retry quota read or mutation";
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
      `postgres-quota-repository unavailable; no fallback is allowed for quota enforcement decisions, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
