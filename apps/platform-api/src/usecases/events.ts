// ---------------------------------------------------------------------------
// Event bus usecase (ADR-0059 / ADR-ACT-0259)
//
// Built-in Postgres outbox: publish (idempotent, tenant-scoped, no secret payload),
// a durable worker tick that claims → dispatches → marks processed or retries/
// dead-letters, operator read surfaces, and audited redrive. Idempotency: a processed
// event is never reprocessed; publish dedups on (org, type, key). Workflow engine is a
// later decision (ADR-0059) gated on this substrate. No secret fields in payloads.
// ---------------------------------------------------------------------------

import { ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  DeadLetterListResponse,
  EventListResponse,
  WorkerListResponse,
} from "@platform/contracts-admin";
import type {
  ClaimedEvent,
  EventBusPort,
  PublishEventInput,
  WorkerRegistryPort,
} from "../ports/event-bus.ts";

export interface EventsDeps {
  bus: EventBusPort;
  workers: WorkerRegistryPort;
  audit: AuditEventPort;
}

export interface EventsActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

/** A handler returns processed (ack) or throws to signal failure (retry / dead-letter). */
export type EventHandler = (event: ClaimedEvent) => Promise<void>;
export type EventHandlerRegistry = Record<string, EventHandler>;

const SECRET_KEY_RE = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

function assertNoSecretPayload(payload: Record<string, unknown> | undefined): void {
  const offending = Object.keys(payload ?? {}).filter((k) => SECRET_KEY_RE.test(k));
  if (offending.length > 0) {
    throw new ValidationError("api.error.secretFieldNotPublishable", {
      safeDetails: { fields: offending },
    });
  }
}

/** Publish an event to the outbox. Idempotent by (org, type, key); rejects secret payloads. */
export async function publishEvent(
  input: PublishEventInput,
  deps: EventsDeps
): Promise<{ published: boolean; deduplicated: boolean }> {
  if (input.eventType.trim().length === 0 || input.idempotencyKey.trim().length === 0) {
    throw new ValidationError("api.error.eventTypeAndKeyRequired", {});
  }
  assertNoSecretPayload(input.payload);
  return deps.bus.publish(input);
}

export interface ProcessResult {
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
}

/**
 * One worker tick: claim a batch, dispatch each to its handler, and ack/retry/dead-letter.
 * A processed event is never re-claimed (status moves to 'processed'). Unknown event types
 * are treated as a handler failure (retry → dead-letter) so nothing is silently dropped.
 */
export async function processNext(
  handlers: EventHandlerRegistry,
  deps: EventsDeps,
  opts: { batch?: number; workerId?: string; workerKind?: string } = {}
): Promise<ProcessResult> {
  if (opts.workerId) {
    await deps.workers.heartbeat(opts.workerId, opts.workerKind ?? "event-worker");
  }
  const claimed = await deps.bus.claimBatch(opts.batch ?? 10);
  const result: ProcessResult = {
    claimed: claimed.length,
    processed: 0,
    retried: 0,
    deadLettered: 0,
  };
  for (const event of claimed) {
    const handler = handlers[event.eventType];
    try {
      if (!handler) throw new Error(`no handler registered for event type "${event.eventType}"`);
      await handler(event);
      await deps.bus.markProcessed(event.id);
      result.processed++;
    } catch (err) {
      const outcome = await deps.bus.recordFailure(
        event.id,
        err instanceof Error ? err.message : String(err)
      );
      if (outcome === "dead_lettered") result.deadLettered++;
      else result.retried++;
    }
  }
  return result;
}

export async function getEvents(
  organisationId: string,
  deps: EventsDeps,
  limit = 100
): Promise<EventListResponse> {
  const rows = await deps.bus.listEvents(organisationId, limit);
  return {
    events: rows.map((r) => ({
      ...r,
      status: r.status as EventListResponse["events"][number]["status"],
    })),
  };
}

export async function getDeadLetters(
  organisationId: string,
  deps: EventsDeps,
  limit = 100
): Promise<DeadLetterListResponse> {
  const rows = await deps.bus.listDeadLetters(organisationId, limit);
  return { deadLetters: rows };
}

export type RedriveResult = { kind: "ok"; eventId: string } | { kind: "not_found" };

/** Operator-only, audited redrive of a dead letter. Audit-before-change. */
export async function redriveEvent(
  input: { deadLetterId: string; actor: EventsActor },
  deps: EventsDeps
): Promise<RedriveResult> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: "", // operator action; the DLQ row carries the tenant
      action: AuditAction.EventRedriven,
      resource: "event",
      resourceId: input.deadLetterId,
      sourceHost: input.actor.sourceHost,
    })
  );
  const redriven = await deps.bus.redrive(input.deadLetterId);
  return redriven ? { kind: "ok", eventId: redriven.eventId } : { kind: "not_found" };
}

/** Operator worker registry view with a derived liveness status. */
export async function listWorkers(
  deps: EventsDeps,
  nowMs: number = Date.now()
): Promise<WorkerListResponse> {
  const STALE_AFTER_S = 60;
  const rows = await deps.workers.listWorkers();
  return {
    workers: rows.map((w) => {
      const secondsSinceHeartbeat = Math.max(
        0,
        Math.round((nowMs - Date.parse(w.lastHeartbeatAt)) / 1000)
      );
      const status =
        w.status === "stopped"
          ? "stopped"
          : secondsSinceHeartbeat > STALE_AFTER_S
            ? "stale"
            : "alive";
      return {
        workerId: w.workerId,
        workerKind: w.workerKind,
        status: status as WorkerListResponse["workers"][number]["status"],
        lastHeartbeatAt: w.lastHeartbeatAt,
        secondsSinceHeartbeat,
      };
    }),
  };
}

export async function recordHeartbeat(
  workerId: string,
  workerKind: string,
  deps: EventsDeps
): Promise<void> {
  await deps.workers.heartbeat(workerId, workerKind);
}
