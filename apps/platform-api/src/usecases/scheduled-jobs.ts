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
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
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

const log = createLogger({
  name: "scheduled-jobs-usecase",
  service: "platform-api",
  boundedContext: "workflow",
});
const tracer = createTracer("scheduled-jobs-usecase");
const scheduledJobMetrics = new Map<string, number>();
const SCHEDULED_JOB_OPERATION_TIMEOUT_MS = 5000;
const SCHEDULED_JOB_RETRY_ATTEMPTS = 2;

export const scheduledJobsWorkflowStateMachine = {
  stateMachineDefinition:
    "scheduled job workflow states are enabled, paused, due, enqueued, deduplicated, failed, and run-now",
  allowedTransitions:
    "allowed transitions: enabled->due->enqueued|deduplicated|failed, enabled->paused, paused->enabled, enabled|paused->run-now",
  forbiddenTransitions:
    "forbidden transitions: paused jobs are rejected from due enqueue; failed due attempts do not advance next_run_at",
  idempotency:
    "due enqueue uses a stable due-window idempotency key; manual run-now uses invocation-specific idempotency key",
  retry: "scheduled job workflow operations retry transient failures with bounded attempts",
  timeout:
    "scheduled job workflow operations fail with timeout after SCHEDULED_JOB_OPERATION_TIMEOUT_MS",
  compensation: "pause is the compensation/cancel transition for scheduled future execution",
  failureHoldingState:
    "failed due job enqueue attempts are counted and not marked run, leaving next_run_at due for operator recovery retry",
  operatorRecovery:
    "operator recovery: inspect failed metric/log entries, repair event bus or job configuration, then retry/redrive the scheduler tick",
};

function recordMetric(operation: string, outcome: "success" | "error"): void {
  const key = `${operation}:${outcome}`;
  scheduledJobMetrics.set(key, (scheduledJobMetrics.get(key) ?? 0) + 1);
}

export function getScheduledJobWorkflowMetric(
  operation: string,
  outcome: "success" | "error"
): number {
  return scheduledJobMetrics.get(`${operation}:${outcome}`) ?? 0;
}

async function withTimeout<T>(operation: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`scheduled_job_workflow_timeout:${operation}`)),
      SCHEDULED_JOB_OPERATION_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withScheduledJobWorkflow<T>(operation: string, run: () => Promise<T>): Promise<T> {
  return withSpan(
    tracer,
    `scheduled-jobs.${operation}`,
    async () => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= SCHEDULED_JOB_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const result = await withTimeout(operation, run);
          recordMetric(operation, "success");
          log.info({ operation, attempt }, "scheduled_jobs.workflow.complete");
          return result;
        } catch (err) {
          lastError = err;
          if (attempt >= SCHEDULED_JOB_RETRY_ATTEMPTS) {
            recordMetric(operation, "error");
            log.error({ err, operation, attempt }, "scheduled_jobs.workflow.failed");
            break;
          }
        }
      }
      throw lastError;
    },
    { "workflow.operation": operation }
  );
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
  return withScheduledJobWorkflow("list", async () => {
    const jobs = opts.operator
      ? await deps.jobs.listForTenantAsOperator(organisationId)
      : await deps.jobs.listForTenant(organisationId);
    return { jobs };
  });
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
  return withScheduledJobWorkflow("set", async () => {
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
  });
}

export interface RunDueResult {
  due: number;
  enqueued: number;
  deduplicated: number;
  failed: number;
}

/**
 * One scheduler tick: enqueue an event for every due (enabled) job, idempotently per
 * due-window, then advance next_run_at. Paused jobs are not returned by listDue, so
 * they never enqueue. Tenant id is preserved on each event.
 */
export async function runDueJobs(deps: ScheduledJobsDeps): Promise<RunDueResult> {
  return withScheduledJobWorkflow("run-due", async () => {
    const due = await deps.jobs.listDue();
    const result: RunDueResult = { due: due.length, enqueued: 0, deduplicated: 0, failed: 0 };
    for (const job of due) {
      try {
        const r = await deps.bus.publish({
          organisationId: job.organisationId,
          eventType: job.eventType,
          idempotencyKey: windowKey(job),
          payload: { ...job.payload, scheduledJobKey: job.jobKey },
        });
        if (r.published) result.enqueued++;
        else result.deduplicated++;
        await deps.jobs.markRun(job.id, job.intervalSeconds);
      } catch (err) {
        result.failed++;
        log.error(
          { err, operation: "run-due", jobId: job.id, jobKey: job.jobKey },
          "scheduled_jobs.due_job.failed"
        );
      }
    }
    return result;
  });
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
  return withScheduledJobWorkflow("run-now", async () => {
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
  });
}

export type SetEnabledResult =
  | { kind: "ok"; job: ScheduledJobListResponse["jobs"][number] }
  | { kind: "not_found" };

/** Operator pause/resume (audited). */
export async function setScheduledJobEnabled(
  input: { jobId: string; enabled: boolean; actor: ScheduledJobsActor },
  deps: ScheduledJobsDeps
): Promise<SetEnabledResult> {
  return withScheduledJobWorkflow("set-enabled", async () => {
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
  });
}
