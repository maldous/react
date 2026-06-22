import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  getScheduledJobWorkflowMetric,
  listScheduledJobs,
  runDueJobs,
  runScheduledJobNow,
  setScheduledJob,
  setScheduledJobEnabled,
} from "../../src/usecases/scheduled-jobs.ts";
import type {
  DueJob,
  ScheduledJobRecord,
  ScheduledJobRepository,
  UpsertScheduledJobInput,
} from "../../src/ports/scheduled-job-repository.ts";
import type { EventBusPort, PublishEventInput } from "../../src/ports/event-bus.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = { actorId: "op", actorRoles: ["system-admin"] };

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}

// In-memory event bus that records idempotent publishes.
function fakeBus(): EventBusPort & { _published: PublishEventInput[]; _keys: Set<string> } {
  const published: PublishEventInput[] = [];
  const keys = new Set<string>();
  return {
    _published: published,
    _keys: keys,
    async publish(input: PublishEventInput) {
      const k = `${input.organisationId}|${input.eventType}|${input.idempotencyKey}`;
      if (keys.has(k)) return { published: false, deduplicated: true };
      keys.add(k);
      published.push(input);
      return { published: true, deduplicated: false };
    },
    async claimBatch() {
      return [];
    },
    async markProcessed() {},
    async recordFailure() {
      return "retry";
    },
    async listEvents() {
      return [];
    },
    async listDeadLetters() {
      return [];
    },
    async redrive() {
      return null;
    },
  };
}

function fakeJobs(): ScheduledJobRepository & {
  _jobs: (ScheduledJobRecord & { organisationId: string; payload: Record<string, unknown> })[];
} {
  const jobs: (ScheduledJobRecord & {
    organisationId: string;
    payload: Record<string, unknown>;
  })[] = [];
  let n = 0;
  const now = () => new Date(0).toISOString();
  return {
    _jobs: jobs,
    async upsert(i: UpsertScheduledJobInput) {
      const existing = jobs.find(
        (j) => j.jobKey === i.jobKey && j.organisationId === i.organisationId
      );
      if (existing) {
        existing.eventType = i.eventType;
        existing.intervalSeconds = i.intervalSeconds;
        existing.enabled = i.enabled;
        return;
      }
      jobs.push({
        id: `job-${++n}-0000-0000-0000-000000000000`,
        organisationId: i.organisationId,
        jobKey: i.jobKey,
        eventType: i.eventType,
        intervalSeconds: i.intervalSeconds,
        enabled: i.enabled,
        nextRunAt: now(),
        lastRunAt: null,
        updatedAt: null,
        updatedBy: i.updatedBy,
        payload: {},
      });
    },
    async listForTenant(org) {
      return jobs.filter((j) => j.organisationId === org);
    },
    async listForTenantAsOperator(org) {
      return jobs.filter((j) => j.organisationId === org);
    },
    async findById(id) {
      return jobs.find((j) => j.id === id) ?? null;
    },
    async listDue(): Promise<DueJob[]> {
      // due = enabled and next_run_at <= now; our fixture nextRunAt is epoch 0 (always due)
      return jobs
        .filter((j) => j.enabled)
        .map((j) => ({
          id: j.id,
          organisationId: j.organisationId,
          jobKey: j.jobKey,
          eventType: j.eventType,
          payload: j.payload,
          intervalSeconds: j.intervalSeconds,
          nextRunAt: j.nextRunAt,
        }));
    },
    async markRun(id) {
      const j = jobs.find((x) => x.id === id);
      // advance to a far-future run so it is no longer due on the next tick
      if (j) j.nextRunAt = new Date(8.64e15).toISOString();
    },
    async setEnabled(id, enabled) {
      const j = jobs.find((x) => x.id === id);
      if (!j) return null;
      j.enabled = enabled;
      return j;
    },
  };
}

function deps() {
  const jobs = fakeJobs();
  const bus = fakeBus();
  const audit = capturingAudit();
  return { jobs, bus, audit, deps: { jobs, bus, audit: audit.port } };
}

describe("scheduled-jobs usecase", () => {
  it("schedule persists and is audited", async () => {
    const { deps: d, jobs, audit } = deps();
    await setScheduledJob(
      {
        organisationId: ORG,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
        actor: ACTOR,
      },
      d
    );
    assert.equal(jobs._jobs.length, 1);
    assert.equal(audit.events[0]?.resource, "scheduled_job");
    assert.equal((await listScheduledJobs(ORG, d, { operator: true })).jobs.length, 1);
  });

  it("a due job enqueues an event preserving tenant id", async () => {
    const { deps: d, bus } = deps();
    await setScheduledJob(
      {
        organisationId: ORG,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
        actor: ACTOR,
      },
      d
    );
    const r = await runDueJobs(d);
    assert.equal(r.enqueued, 1);
    assert.equal(bus._published[0]?.organisationId, ORG);
    assert.equal(bus._published[0]?.eventType, "report.run");
  });

  it("a paused job does not enqueue", async () => {
    const { deps: d, jobs, bus } = deps();
    await setScheduledJob(
      {
        organisationId: ORG,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
        enabled: false,
        actor: ACTOR,
      },
      d
    );
    const jobId = jobs._jobs[0]!.id;
    await setScheduledJobEnabled({ jobId, enabled: false, actor: ACTOR }, d);
    const r = await runDueJobs(d);
    assert.equal(r.due, 0);
    assert.equal(bus._published.length, 0);
  });

  it("idempotency prevents duplicate enqueue in the same due window", async () => {
    const { deps: d, jobs, bus } = deps();
    await setScheduledJob(
      {
        organisationId: ORG,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
        actor: ACTOR,
      },
      d
    );
    await runDueJobs(d); // enqueues + markRun (advances next_run_at far)
    // reset next_run_at back to the SAME window to simulate a racing tick
    jobs._jobs[0]!.nextRunAt = new Date(0).toISOString();
    const second = await runDueJobs(d);
    assert.equal(second.enqueued, 0, "same-window re-tick must not double-enqueue");
    assert.equal(second.deduplicated, 1);
    assert.equal(bus._published.length, 1);
    assert.equal(getScheduledJobWorkflowMetric("run-due", "success") > 0, true);
  });

  it("failed due enqueue stays in failure holding state and does not mark run", async () => {
    const { deps: d, jobs } = deps();
    await setScheduledJob(
      {
        organisationId: ORG,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
        actor: ACTOR,
      },
      d
    );
    const originalNextRunAt = jobs._jobs[0]!.nextRunAt;
    const failing = {
      ...d,
      bus: {
        ...d.bus,
        async publish() {
          throw new Error("event bus unavailable");
        },
      },
    };
    const result = await runDueJobs(failing);
    assert.equal(result.failed, 1);
    assert.equal(result.enqueued, 0);
    assert.equal(jobs._jobs[0]!.nextRunAt, originalNextRunAt);
  });

  it("run-now enqueues an event (audited)", async () => {
    const { deps: d, jobs, bus, audit } = deps();
    await setScheduledJob(
      {
        organisationId: ORG,
        jobKey: "nightly",
        eventType: "report.run",
        intervalSeconds: 3600,
        enabled: false,
        actor: ACTOR,
      },
      d
    );
    const jobId = jobs._jobs[0]!.id;
    const r = await runScheduledJobNow({ jobId, actor: ACTOR }, d, 12345);
    assert.equal(r.kind === "ok" && r.response.enqueued, true);
    assert.equal(bus._published.length, 1);
    assert.ok(audit.events.some((e) => e.action === "scheduled_job.run"));
  });
});
