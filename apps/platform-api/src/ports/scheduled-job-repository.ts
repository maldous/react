// ---------------------------------------------------------------------------
// Scheduled-job repository port (ADR-0059 / ADR-ACT-0262).
//
// Built-in scheduler state. Due jobs enqueue events onto the Phase-5 outbox
// (EventBusPort). Tenant-scoped (RLS); the scheduler tick reads due jobs across
// tenants via withSystemAdmin (system infra), preserving each job's organisation_id.
// No secret fields.
// ---------------------------------------------------------------------------

export interface ScheduledJobRecord {
  id: string;
  jobKey: string;
  eventType: string;
  intervalSeconds: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpsertScheduledJobInput {
  organisationId: string;
  jobKey: string;
  eventType: string;
  intervalSeconds: number;
  enabled: boolean;
  updatedBy: string;
}

export interface DueJob {
  id: string;
  organisationId: string;
  jobKey: string;
  eventType: string;
  payload: Record<string, unknown>;
  intervalSeconds: number;
  nextRunAt: string;
}

export interface ScheduledJobRepository {
  upsert(input: UpsertScheduledJobInput): Promise<void>;
  listForTenant(organisationId: string): Promise<ScheduledJobRecord[]>;
  listForTenantAsOperator(organisationId: string): Promise<ScheduledJobRecord[]>;
  findById(
    jobId: string
  ): Promise<
    (ScheduledJobRecord & { organisationId: string; payload: Record<string, unknown> }) | null
  >;
  /** Enabled jobs whose next_run_at <= now (operator/rls_bypass, cross-tenant). */
  listDue(): Promise<DueJob[]>;
  /** Advance a job after a run: last_run_at = now, next_run_at = now + interval. */
  markRun(jobId: string, intervalSeconds: number): Promise<void>;
  setEnabled(
    jobId: string,
    enabled: boolean,
    updatedBy: string
  ): Promise<ScheduledJobRecord | null>;
}
