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

export class PostgresScheduledJobRepository implements ScheduledJobRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async upsert(input: UpsertScheduledJobInput): Promise<void> {
    await withSystemAdmin(this.pool as never, (client) =>
      client.query(
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
      )
    );
  }

  private async list(organisationId: string, operator: boolean): Promise<ScheduledJobRecord[]> {
    const q = (client: {
      query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    }) =>
      client
        .query(
          `SELECT ${COLS} FROM public.scheduled_jobs WHERE organisation_id = $1 ORDER BY job_key`,
          [organisationId]
        )
        .then((r) => r.rows.map(toRecord));
    return operator
      ? withSystemAdmin(this.pool as never, q as never)
      : withTenant(this.pool as never, organisationId, q as never);
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
    return withSystemAdmin(this.pool as never, async (client) => {
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
    });
  }

  async listDue(): Promise<DueJob[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
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
    });
  }

  async markRun(jobId: string, intervalSeconds: number): Promise<void> {
    await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `UPDATE public.scheduled_jobs
            SET last_run_at = now(), next_run_at = now() + make_interval(secs => $2::int), updated_at = now()
          WHERE id = $1`,
        [jobId, intervalSeconds]
      )
    );
  }

  async setEnabled(
    jobId: string,
    enabled: boolean,
    updatedBy: string
  ): Promise<ScheduledJobRecord | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.scheduled_jobs SET enabled = $2, updated_by = $3, updated_at = now()
          WHERE id = $1 RETURNING ${COLS}`,
        [jobId, enabled, updatedBy]
      );
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? toRecord(row) : null;
    });
  }
}
