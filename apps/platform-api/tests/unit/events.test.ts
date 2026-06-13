import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  getDeadLetters,
  getEvents,
  listWorkers,
  processNext,
  publishEvent,
  redriveEvent,
} from "../../src/usecases/events.ts";
import type {
  ClaimedEvent,
  DeadLetterRow,
  EventBusPort,
  EventRow,
  PublishEventInput,
  WorkerRecord,
  WorkerRegistryPort,
} from "../../src/ports/event-bus.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = { actorId: "op", actorRoles: ["system-admin"] };

// In-memory outbox mirroring the Postgres adapter contract (idempotency, claim,
// retry → dead-letter at max_attempts, redrive).
function fakeBus(): EventBusPort & {
  _events: Map<string, ClaimedEvent & { status: string; attempts: number }>;
  _dlq: DeadLetterRow[];
} {
  const events = new Map<string, ClaimedEvent & { status: string; attempts: number }>();
  const dlq: DeadLetterRow[] = [];
  let n = 0;
  return {
    _events: events,
    _dlq: dlq,
    async publish(input: PublishEventInput) {
      const key = `${input.organisationId}|${input.eventType}|${input.idempotencyKey}`;
      if (
        [...events.values()].some(
          (e) => `${e.organisationId}|${e.eventType}|${e.idempotencyKey}` === key
        )
      ) {
        return { published: false, deduplicated: true };
      }
      const id = `e${++n}`;
      events.set(id, {
        id,
        organisationId: input.organisationId,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload ?? {},
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        status: "pending",
      });
      return { published: true, deduplicated: false };
    },
    async claimBatch(limit) {
      const claimed: ClaimedEvent[] = [];
      for (const e of events.values()) {
        if (e.status === "pending" && claimed.length < limit) {
          e.status = "processing";
          claimed.push({ ...e });
        }
      }
      return claimed;
    },
    async markProcessed(id) {
      const e = events.get(id);
      if (e) e.status = "processed";
    },
    async recordFailure(id, error) {
      const e = events.get(id);
      if (!e) return "retry";
      e.attempts += 1;
      if (e.attempts >= e.maxAttempts) {
        e.status = "failed";
        dlq.push({
          id: `dl${dlq.length + 1}`,
          eventId: id,
          organisationId: e.organisationId,
          eventType: e.eventType,
          attempts: e.attempts,
          lastError: error,
          deadAt: new Date(0).toISOString(),
          redrivenAt: null,
        });
        return "dead_lettered";
      }
      e.status = "pending";
      return "retry";
    },
    async listEvents(org): Promise<EventRow[]> {
      return [...events.values()]
        .filter((e) => e.organisationId === org)
        .map((e) => ({
          id: e.id,
          organisationId: e.organisationId,
          eventType: e.eventType,
          status: e.status,
          attempts: e.attempts,
          maxAttempts: e.maxAttempts,
          lastError: null,
          createdAt: new Date(0).toISOString(),
          processedAt: null,
        }));
    },
    async listDeadLetters(org) {
      return dlq.filter((d) => d.organisationId === org);
    },
    async redrive(deadLetterId) {
      const dl = dlq.find((d) => d.id === deadLetterId && d.redrivenAt == null);
      if (!dl) return null;
      dl.redrivenAt = new Date(0).toISOString();
      const id = `e${++n}`;
      events.set(id, {
        id,
        organisationId: dl.organisationId,
        eventType: dl.eventType,
        idempotencyKey: `${id}-redrive`,
        payload: {},
        attempts: 0,
        maxAttempts: 5,
        status: "pending",
      });
      return { eventId: id };
    },
  };
}

function fakeWorkers(): WorkerRegistryPort & { _beats: Map<string, WorkerRecord> } {
  const beats = new Map<string, WorkerRecord>();
  return {
    _beats: beats,
    async heartbeat(workerId, workerKind, status = "alive") {
      beats.set(workerId, {
        workerId,
        workerKind,
        status,
        lastHeartbeatAt: new Date(0).toISOString(),
      });
    },
    async listWorkers() {
      return [...beats.values()];
    },
  };
}

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { events, port: { emit: async (e) => void events.push(e), query: async () => events } };
}

function deps() {
  const bus = fakeBus();
  const workers = fakeWorkers();
  const audit = capturingAudit();
  return { bus, workers, audit, deps: { bus, workers, audit: audit.port } };
}

describe("events usecase", () => {
  it("publish persists and is idempotent by (org, type, key)", async () => {
    const { deps: d } = deps();
    const r1 = await publishEvent(
      { organisationId: ORG, eventType: "thing.created", idempotencyKey: "k1" },
      d
    );
    const r2 = await publishEvent(
      { organisationId: ORG, eventType: "thing.created", idempotencyKey: "k1" },
      d
    );
    assert.equal(r1.published, true);
    assert.equal(r2.deduplicated, true);
  });

  it("rejects secret-bearing payload fields", async () => {
    const { deps: d } = deps();
    await assert.rejects(
      publishEvent(
        { organisationId: ORG, eventType: "x", idempotencyKey: "k", payload: { token: "leak" } },
        d
      )
    );
  });

  it("worker consumes and marks processed; a processed event is not re-claimed", async () => {
    const { deps: d } = deps();
    await publishEvent(
      { organisationId: ORG, eventType: "thing.created", idempotencyKey: "k1" },
      d
    );
    const handled: string[] = [];
    const handlers = { "thing.created": async (e: ClaimedEvent) => void handled.push(e.id) };
    const r1 = await processNext(handlers, d, { workerId: "w1", workerKind: "test" });
    assert.equal(r1.processed, 1);
    const r2 = await processNext(handlers, d);
    assert.equal(r2.claimed, 0, "processed events are not re-claimed (idempotent processing)");
    assert.equal(handled.length, 1);
  });

  it("handler failure retries then dead-letters at max_attempts", async () => {
    const { deps: d, bus } = deps();
    await publishEvent(
      { organisationId: ORG, eventType: "boom", idempotencyKey: "k1", maxAttempts: 2 },
      d
    );
    const handlers = {
      boom: async () => {
        throw new Error("handler boom");
      },
    };
    const r1 = await processNext(handlers, d);
    assert.equal(r1.retried, 1);
    const r2 = await processNext(handlers, d);
    assert.equal(r2.deadLettered, 1);
    assert.equal(bus._dlq.length, 1);
  });

  it("unknown event type is treated as a failure (never silently dropped)", async () => {
    const { deps: d } = deps();
    await publishEvent(
      { organisationId: ORG, eventType: "no.handler", idempotencyKey: "k1", maxAttempts: 1 },
      d
    );
    const r = await processNext({}, d);
    assert.equal(r.deadLettered, 1);
  });

  it("redrive requeues a dead letter and is audited; the event is then processable", async () => {
    const { deps: d, bus, audit } = deps();
    await publishEvent(
      { organisationId: ORG, eventType: "boom", idempotencyKey: "k1", maxAttempts: 1 },
      d
    );
    await processNext(
      {
        boom: async () => {
          throw new Error("x");
        },
      },
      d
    );
    const dl = (await getDeadLetters(ORG, d)).deadLetters[0]!;
    const r = await redriveEvent({ deadLetterId: dl.id, actor: ACTOR }, d);
    assert.equal(r.kind, "ok");
    assert.equal(
      audit.events.some((e) => e.resource === "event"),
      true
    );
    // the requeued event is processable
    const handled: string[] = [];
    await processNext({ boom: async (e: ClaimedEvent) => void handled.push(e.id) }, d);
    assert.equal(handled.length, 1);
    assert.equal(bus._dlq[0]?.redrivenAt != null, true);
  });

  it("tenant id is preserved through publish → list", async () => {
    const { deps: d } = deps();
    await publishEvent({ organisationId: ORG, eventType: "t", idempotencyKey: "k1" }, d);
    const list = await getEvents(ORG, d);
    assert.equal(
      list.events.every((e) => e.organisationId === ORG),
      true
    );
  });

  it("worker heartbeat is recorded and listed with a liveness status", async () => {
    const { deps: d } = deps();
    await processNext({}, d, { workerId: "w1", workerKind: "event-worker" });
    const workers = await listWorkers(d, 0);
    assert.equal(
      workers.workers.some((w) => w.workerId === "w1"),
      true
    );
  });
});
