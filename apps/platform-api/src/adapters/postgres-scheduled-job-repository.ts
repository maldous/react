/**
 * PostgresScheduledJobRepository (ADR-0059 / ADR-ACT-0262).
 *
 * Backed by public.scheduled_jobs (migration 030), RLS-enabled. Tenant reads use
 * withTenant; operator reads + the cross-tenant due-scan + markRun/setEnabled use
 * withSystemAdmin (the scheduler is system infra; each job keeps its organisation_id).
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  DueJob,
  ScheduledJobRecord,
  ScheduledJobRepository,
  UpsertScheduledJobInput,
} from "../ports/scheduled-job-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresScheduledJobProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: Record<string, unknown>): ScheduledJobRecord {
  return {
    id: r["id"] as string,
    jobKey: r["job_key"] as string,
    eventType: r["event_type"] as string,
    intervalSeconds: Number(r["interval_seconds"]),
    enabled: r["enabled"] as boolean,
    nextRunAt: iso(r["next_run_at"] as Date) ?? "",
    lastRunAt: iso(r["last_run_at"] as Date | null),
    updatedAt: iso(r["updated_at"] as Date | null),
    updatedBy: (r["updated_by"] as string | null) ?? null,
  };
}

const COLS =
  "id, job_key, event_type, interval_seconds, enabled, next_run_at, last_run_at, updated_at, updated_by";

export function loadPostgresScheduledJobProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresScheduledJobProviderConfig {
  return {
    statementTimeoutMs: Number(env["SCHEDULED_JOB_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["SCHEDULED_JOB_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["SCHEDULED_JOB_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresScheduledJobRepository implements ScheduledJobRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresScheduledJobProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresScheduledJobProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresScheduledJobProviderConfig(),
      ...config,
    };
  }

  async upsert(input: UpsertScheduledJobInput): Promise<void> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `INSERT INTO public.scheduled_jobs
           (organisation_id, job_key, event_type, interval_seconds, enabled, next_run_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4::int, $5, now() + make_interval(secs => $4::int), $6, now())
         ON CONFLICT (organisation_id, job_key) DO UPDATE SET
           event_type = EXCLUDED.event_type, interval_seconds = EXCLUDED.interval_seconds,
           enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [
            input.organisationId,
            input.jobKey,
            input.eventType,
            input.intervalSeconds,
            input.enabled,
            input.updatedBy,
          ]
        );
      })
    );
  }

  private async list(organisationId: string, operator: boolean): Promise<ScheduledJobRecord[]> {
    const q = async (client: PgClient) => {
      await this.applyQueryTimeout(client);
      const r = await client.query<Record<string, unknown>>(
        `SELECT ${COLS} FROM public.scheduled_jobs WHERE organisation_id = $1 ORDER BY job_key`,
        [organisationId]
      );
      return r.rows.map(toRecord);
    };
    return this.withRetry(() =>
      operator
        ? withSystemAdmin(this.pool as never, q as never)
        : withTenant(this.pool as never, organisationId, q as never)
    );
  }
  listForTenant(organisationId: string): Promise<ScheduledJobRecord[]> {
    return this.list(organisationId, false);
  }
  listForTenantAsOperator(organisationId: string): Promise<ScheduledJobRecord[]> {
    return this.list(organisationId, true);
  }

  async findById(
    jobId: string
  ): Promise<
    (ScheduledJobRecord & { organisationId: string; payload: Record<string, unknown> }) | null
  > {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `SELECT ${COLS}, organisation_id, payload FROM public.scheduled_jobs WHERE id = $1`,
          [jobId]
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        return {
          ...toRecord(row),
          organisationId: row["organisation_id"] as string,
          payload: (row["payload"] as Record<string, unknown>) ?? {},
        };
      })
    );
  }

  async listDue(): Promise<DueJob[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `SELECT id, organisation_id, job_key, event_type, payload, interval_seconds, next_run_at
           FROM public.scheduled_jobs
          WHERE enabled = true AND next_run_at <= now()
          ORDER BY next_run_at`
        );
        return (r.rows as Record<string, unknown>[]).map((row) => ({
          id: row["id"] as string,
          organisationId: row["organisation_id"] as string,
          jobKey: row["job_key"] as string,
          eventType: row["event_type"] as string,
          payload: (row["payload"] as Record<string, unknown>) ?? {},
          intervalSeconds: Number(row["interval_seconds"]),
          nextRunAt: iso(row["next_run_at"] as Date) ?? "",
        }));
      })
    );
  }

  async markRun(jobId: string, intervalSeconds: number): Promise<void> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `UPDATE public.scheduled_jobs
            SET last_run_at = now(), next_run_at = now() + make_interval(secs => $2::int), updated_at = now()
          WHERE id = $1`,
          [jobId, intervalSeconds]
        );
      })
    );
  }

  async setEnabled(
    jobId: string,
    enabled: boolean,
    updatedBy: string
  ): Promise<ScheduledJobRecord | null> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `UPDATE public.scheduled_jobs SET enabled = $2, updated_by = $3, updated_at = now()
          WHERE id = $1 RETURNING ${COLS}`,
          [jobId, enabled, updatedBy]
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? toRecord(row) : null;
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-scheduled-job-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'scheduled_jobs'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-scheduled-job-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 030-scheduled-jobs.sql, inspect scheduled_jobs RLS/grants and scheduler event bus dependencies, then retry due scan or job update";
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
      `postgres-scheduled-job-repository unavailable; no fallback is allowed for scheduled job persistence or due scans, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
