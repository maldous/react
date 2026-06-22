/**
 * PostgresRateLimitRepository (ADR-0065 / ADR-ACT-0257).
 *
 * Backed by public.rate_limit_policies + public.rate_limit_counters (migration 025),
 * RLS-enabled. Policy definitions are operator-managed; the counter is a durable
 * fixed-window bucket keyed by (org, policy, window_start). incrementAndCount upserts
 * the current window's row atomically and returns the running count. Tenant reads use
 * withTenant (RLS-scoped); writes + counter mutation + operator reads use withSystemAdmin.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  RateLimitPolicyRecord,
  RateLimitRepository,
  UpsertRateLimitInput,
} from "../ports/rate-limit-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresRateLimitProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

interface PolicyRow {
  policy_key: string;
  entitlement_key: string;
  limit_value: string | number;
  window_seconds: number;
  action: "allow" | "deny";
  updated_at: Date | string | null;
  updated_by: string | null;
}

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: PolicyRow): RateLimitPolicyRecord {
  return {
    policyKey: r.policy_key,
    entitlementKey: r.entitlement_key,
    limit: Number(r.limit_value),
    windowSeconds: r.window_seconds,
    action: r.action,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

const COLUMNS =
  "policy_key, entitlement_key, limit_value, window_seconds, action, updated_at, updated_by";

export function loadPostgresRateLimitProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresRateLimitProviderConfig {
  return {
    statementTimeoutMs: Number(env["RATE_LIMIT_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["RATE_LIMIT_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["RATE_LIMIT_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresRateLimitRepository implements RateLimitRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresRateLimitProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresRateLimitProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresRateLimitProviderConfig(),
      ...config,
    };
  }

  async getByKey(organisationId: string, policyKey: string): Promise<RateLimitPolicyRecord | null> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<PolicyRow>(
          `SELECT ${COLUMNS} FROM public.rate_limit_policies WHERE organisation_id = $1 AND policy_key = $2`,
          [organisationId, policyKey]
        );
        const row = r.rows[0];
        return row ? toRecord(row) : null;
      })
    );
  }

  async listForTenant(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<PolicyRow>(
          `SELECT ${COLUMNS} FROM public.rate_limit_policies ORDER BY policy_key`
        );
        return r.rows.map(toRecord);
      })
    );
  }

  async listForTenantAsOperator(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<PolicyRow>(
          `SELECT ${COLUMNS} FROM public.rate_limit_policies WHERE organisation_id = $1 ORDER BY policy_key`,
          [organisationId]
        );
        return r.rows.map(toRecord);
      })
    );
  }

  async upsert(input: UpsertRateLimitInput): Promise<void> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `INSERT INTO public.rate_limit_policies
           (organisation_id, policy_key, entitlement_key, limit_value, window_seconds, action, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (organisation_id, policy_key) DO UPDATE SET
           entitlement_key = EXCLUDED.entitlement_key,
           limit_value     = EXCLUDED.limit_value,
           window_seconds  = EXCLUDED.window_seconds,
           action          = EXCLUDED.action,
           updated_by      = EXCLUDED.updated_by,
           updated_at      = now()`,
          [
            input.organisationId,
            input.policyKey,
            input.entitlementKey,
            input.limit,
            input.windowSeconds,
            input.action,
            input.updatedBy,
          ]
        );
      })
    );
  }

  // Fixed-window bucket: floor(now / window) * window. Computed in SQL so the bucket
  // boundary is server-clock authoritative and not subject to app-clock skew.
  private windowStartSql(windowSeconds: number): string {
    return `to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds})`;
  }

  async incrementAndCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ count: string | number }>(
          `INSERT INTO public.rate_limit_counters (organisation_id, policy_key, window_start, count)
         VALUES ($1, $2, ${this.windowStartSql(windowSeconds)}, 1)
         ON CONFLICT (organisation_id, policy_key, window_start)
           DO UPDATE SET count = public.rate_limit_counters.count + 1
         RETURNING count`,
          [organisationId, policyKey]
        );
        return Number(r.rows[0]!.count);
      })
    );
  }

  async currentCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ count: string }>(
          `SELECT COALESCE(count, 0)::text AS count FROM public.rate_limit_counters
          WHERE organisation_id = $1 AND policy_key = $2
            AND window_start = ${this.windowStartSql(windowSeconds)}`,
          [organisationId, policyKey]
        );
        return Number(r.rows[0]?.count ?? "0");
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-rate-limit-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('rate_limit_policies', 'rate_limit_counters')
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-rate-limit-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 025-rate-limits.sql, inspect rate_limit_policies/rate_limit_counters RLS/grants and fixed-window indexes, then retry rate-limit policy or counter operation";
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
      `postgres-rate-limit-repository unavailable; no fallback is allowed for durable rate-limit policy and counter decisions, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
