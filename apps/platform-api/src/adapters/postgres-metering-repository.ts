/**
 * PostgresMeteringRepository (ADR-0067 / ADR-ACT-0256).
 *
 * Backed by public.meter_events (migration 024), RLS-enabled. Idempotent inserts
 * via the (organisation_id, meter_key, idempotency_key) unique constraint +
 * ON CONFLICT DO NOTHING. Tenant self-aggregation uses withTenant (RLS-scoped);
 * recording + operator aggregation use withSystemAdmin (rls_bypass). No secrets.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { QuotaWindow } from "@platform/contracts-admin";
import type { MeteringRepository, RecordMeterEventInput } from "../ports/metering-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresMeteringProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

// Window → time predicate. Window comes from a fixed enum (never user free-text).
const WINDOW_SQL: Record<QuotaWindow, string> = {
  daily: "occurred_at >= date_trunc('day', now())",
  monthly: "occurred_at >= date_trunc('month', now())",
  rolling_30d: "occurred_at >= now() - interval '30 days'",
  lifetime: "true",
};

export function loadPostgresMeteringProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresMeteringProviderConfig {
  return {
    statementTimeoutMs: Number(env["METERING_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["METERING_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["METERING_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresMeteringRepository implements MeteringRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresMeteringProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresMeteringProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresMeteringProviderConfig(),
      ...config,
    };
  }

  async record(
    input: RecordMeterEventInput
  ): Promise<{ recorded: boolean; deduplicated: boolean }> {
    const metadata = JSON.stringify(input.metadata ?? {});
    const result = await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        return client.query(
          `INSERT INTO public.meter_events
           (organisation_id, meter_key, subject_id, quantity, idempotency_key, occurred_at, source, metadata)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8::jsonb)
         ON CONFLICT (organisation_id, meter_key, idempotency_key) DO NOTHING`,
          [
            input.organisationId,
            input.meterKey,
            input.subjectId ?? null,
            input.quantity,
            input.idempotencyKey,
            input.occurredAt ?? null,
            input.source ?? "platform",
            metadata,
          ]
        );
      })
    );
    const inserted = (result.rowCount ?? 0) > 0;
    return { recorded: inserted, deduplicated: !inserted };
  }

  private async sum(
    client: { query: (t: string, v?: unknown[]) => Promise<{ rows: { total: string }[] }> },
    organisationId: string,
    meterKey: string,
    window: QuotaWindow
  ): Promise<number> {
    const r = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::text AS total
         FROM public.meter_events
        WHERE organisation_id = $1 AND meter_key = $2 AND ${WINDOW_SQL[window]}`,
      [organisationId, meterKey]
    );
    return Number(r.rows[0]?.total ?? "0");
  }

  async aggregate(organisationId: string, meterKey: string, window: QuotaWindow): Promise<number> {
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        return this.sum(client, organisationId, meterKey, window);
      })
    );
  }

  async aggregateAsOperator(
    organisationId: string,
    meterKey: string,
    window: QuotaWindow
  ): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        return this.sum(client, organisationId, meterKey, window);
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-metering-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'meter_events'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-metering-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 024-metering-and-quotas.sql, inspect meter_events RLS/grants and idempotency index, then retry metering record or aggregation";
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
      `postgres-metering-repository unavailable; no fallback is allowed for metering usage records, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
