// ---------------------------------------------------------------------------
// Scheduled jobs usecase (ADR-0059 / ADR-ACT-0262)
//
// Built-in scheduler on the proven Phase-5 event substrate. A due job publishes an
// event onto the outbox with an idempotency key derived from the job + its due-window
// bucket, so a double scheduler tick in the same window does NOT double-enqueue (the
// event bus dedups). The worker runtime then processes the event. Paused jobs never
// enqueue. Tenant context is preserved on every event. Operator-managed + audited.
// Workflow engine (Windmill/Temporal) remains a later decision — NOT delivered.
// ---------------------------------------------------------------------------

import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { RunScheduledJobResponse, ScheduledJobListResponse } from "@platform/contracts-admin";
import type { EventBusPort } from "../ports/event-bus.ts";
import type { DueJob, ScheduledJobRepository } from "../ports/scheduled-job-repository.ts";

export interface ScheduledJobsDeps {
  jobs: ScheduledJobRepository;
  bus: EventBusPort;
  audit: AuditEventPort;
}

export interface ScheduledJobsActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

/** Idempotency key for a due-window enqueue: stable within the same window bucket. */
function windowKey(job: DueJob): string {
  const bucket = Math.floor(Date.parse(job.nextRunAt) / (job.intervalSeconds * 1000));
  return `sched:${job.jobKey}:${bucket}`;
}

export async function listScheduledJobs(
  organisationId: string,
  deps: ScheduledJobsDeps,
  opts: { operator?: boolean } = {}
): Promise<ScheduledJobListResponse> {
  const jobs = opts.operator
    ? await deps.jobs.listForTenantAsOperator(organisationId)
    : await deps.jobs.listForTenant(organisationId);
  return { jobs };
}

/** Operator-only, audited schedule upsert. */
export async function setScheduledJob(
  input: {
    organisationId: string;
    jobKey: string;
    eventType: string;
    intervalSeconds: number;
    enabled?: boolean;
    actor: ScheduledJobsActor;
  },
  deps: ScheduledJobsDeps
): Promise<{ jobKey: string }> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.ScheduledJobSet,
      resource: "scheduled_job",
      resourceId: input.jobKey,
      metadata: { eventType: input.eventType, intervalSeconds: input.intervalSeconds },
      sourceHost: input.actor.sourceHost,
    })
  );
  await deps.jobs.upsert({
    organisationId: input.organisationId,
    jobKey: input.jobKey,
    eventType: input.eventType,
    intervalSeconds: input.intervalSeconds,
    enabled: input.enabled ?? true,
    updatedBy: input.actor.actorId,
  });
  return { jobKey: input.jobKey };
}

export interface RunDueResult {
  due: number;
  enqueued: number;
  deduplicated: number;
}

/**
 * One scheduler tick: enqueue an event for every due (enabled) job, idempotently per
 * due-window, then advance next_run_at. Paused jobs are not returned by listDue, so
 * they never enqueue. Tenant id is preserved on each event.
 */
export async function runDueJobs(deps: ScheduledJobsDeps): Promise<RunDueResult> {
  const due = await deps.jobs.listDue();
  const result: RunDueResult = { due: due.length, enqueued: 0, deduplicated: 0 };
  for (const job of due) {
    const r = await deps.bus.publish({
      organisationId: job.organisationId,
      eventType: job.eventType,
      idempotencyKey: windowKey(job),
      payload: { ...job.payload, scheduledJobKey: job.jobKey },
    });
    if (r.published) result.enqueued++;
    else result.deduplicated++;
    await deps.jobs.markRun(job.id, job.intervalSeconds);
  }
  return result;
}

export type RunNowResult =
  | { kind: "ok"; response: RunScheduledJobResponse }
  | { kind: "not_found" };

/** Operator run-now: enqueue immediately (audited). Unique key per invocation. */
export async function runScheduledJobNow(
  input: { jobId: string; actor: ScheduledJobsActor },
  deps: ScheduledJobsDeps,
  nowMs: number = Date.now()
): Promise<RunNowResult> {
  const job = await deps.jobs.findById(input.jobId);
  if (!job) return { kind: "not_found" };
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: job.organisationId,
      action: AuditAction.ScheduledJobRun,
      resource: "scheduled_job",
      resourceId: job.jobKey,
      sourceHost: input.actor.sourceHost,
    })
  );
  const r = await deps.bus.publish({
    organisationId: job.organisationId,
    eventType: job.eventType,
    idempotencyKey: `sched:${job.jobKey}:manual:${nowMs}`,
    payload: { ...job.payload, scheduledJobKey: job.jobKey, manual: true },
  });
  return {
    kind: "ok",
    response: { jobKey: job.jobKey, enqueued: r.published, deduplicated: r.deduplicated },
  };
}

export type SetEnabledResult =
  | { kind: "ok"; job: ScheduledJobListResponse["jobs"][number] }
  | { kind: "not_found" };

/** Operator pause/resume (audited). */
export async function setScheduledJobEnabled(
  input: { jobId: string; enabled: boolean; actor: ScheduledJobsActor },
  deps: ScheduledJobsDeps
): Promise<SetEnabledResult> {
  const existing = await deps.jobs.findById(input.jobId);
  if (!existing) return { kind: "not_found" };
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: existing.organisationId,
      action: AuditAction.ScheduledJobSet,
      resource: "scheduled_job",
      resourceId: existing.jobKey,
      metadata: { enabled: input.enabled },
      sourceHost: input.actor.sourceHost,
    })
  );
  const job = await deps.jobs.setEnabled(input.jobId, input.enabled, input.actor.actorId);
  return job ? { kind: "ok", job } : { kind: "not_found" };
}
