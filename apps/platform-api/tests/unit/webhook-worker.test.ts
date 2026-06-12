/**
 * Unit tests for ADR-0052 / ADR-ACT-0222 — webhook durable delivery worker.
 * Deterministic: a fake in-memory queue store + fake dispatch + injected `now`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  emitWebhookEvent,
  processDueDeliveries,
  type WorkerDeps,
} from "../../src/usecases/webhook-worker.ts";
import type { WebhookDispatchPort, WebhookDispatchResult } from "../../src/usecases/webhooks.ts";
import type {
  ClaimedDelivery,
  DeliveryResult,
  WebhookStore,
  WebhookSubscriptionRecord,
} from "../../src/ports/webhook-store.ts";

interface QueueRow {
  id: string;
  organisationId: string;
  subscriptionId: string;
  event: string;
  payload: string | null;
  status: string;
  attempt: number;
  nextAttemptAt: Date | null;
  responseStatus: number | null;
  error: string | null;
}

function makeStore(
  subs: Array<Partial<WebhookSubscriptionRecord> & { id: string }>
): WebhookStore & {
  rows: QueueRow[];
  secrets: Map<string, string>;
} {
  const subMap = new Map<string, WebhookSubscriptionRecord>();
  const secrets = new Map<string, string>();
  for (const s of subs) {
    subMap.set(s.id, {
      id: s.id,
      url: s.url ?? "https://x.test/h",
      enabled: s.enabled ?? true,
      eventTypes: s.eventTypes ?? ["platform.test"],
      hasSecret: true,
      createdAt: null,
      updatedAt: null,
    });
    secrets.set(s.id, `secret-${s.id}`);
  }
  const rows: QueueRow[] = [];
  let n = 0;
  const base = {
    rows,
    secrets,
    async list(_orgId: string) {
      return [...subMap.values()].map((s) => ({ ...s }));
    },
    async get(_orgId: string, id: string) {
      return subMap.get(id) ?? null;
    },
    async getSecret(_orgId: string, id: string) {
      return secrets.get(id) ?? null;
    },
    async enqueueDelivery(input: {
      organisationId: string;
      subscriptionId: string;
      event: string;
      payload: string;
    }) {
      rows.push({
        id: `d-${++n}`,
        organisationId: input.organisationId,
        subscriptionId: input.subscriptionId,
        event: input.event,
        payload: input.payload,
        status: "pending",
        attempt: 0,
        nextAttemptAt: new Date(0),
        responseStatus: null,
        error: null,
      });
    },
    async claimDueDeliveries(limit: number, now: Date): Promise<ClaimedDelivery[]> {
      const due = rows
        .filter(
          (r) =>
            (r.status === "pending" || r.status === "processing") &&
            r.nextAttemptAt !== null &&
            r.nextAttemptAt.getTime() <= now.getTime()
        )
        .slice(0, limit);
      for (const r of due) r.status = "processing";
      return due.map((r) => ({
        id: r.id,
        organisationId: r.organisationId,
        subscriptionId: r.subscriptionId,
        event: r.event as "platform.test",
        payload: r.payload,
        attempt: r.attempt,
      }));
    },
    async markDeliveryResult(id: string, result: DeliveryResult) {
      const r = rows.find((x) => x.id === id);
      if (!r) return;
      r.status = result.status;
      r.responseStatus = result.responseStatus;
      r.attempt = result.attempt;
      r.error = result.error;
      r.nextAttemptAt = result.nextAttemptAt;
    },
  } as unknown as WebhookStore & { rows: QueueRow[]; secrets: Map<string, string> };
  return base;
}

const dispatchOk: WebhookDispatchPort = {
  async dispatch(): Promise<WebhookDispatchResult> {
    return { ok: true, status: 200, error: null };
  },
};
const dispatchFail: WebhookDispatchPort = {
  async dispatch(): Promise<WebhookDispatchResult> {
    return { ok: false, status: 500, error: "HTTP 500" };
  },
};

describe("emitWebhookEvent (ADR-0052)", () => {
  it("fans out only to enabled subscriptions subscribed to the event", async () => {
    const store = makeStore([
      { id: "a", enabled: true, eventTypes: ["tenant.config.changed"] },
      { id: "b", enabled: false, eventTypes: ["tenant.config.changed"] }, // disabled → skip
      { id: "c", enabled: true, eventTypes: ["platform.test"] }, // not subscribed → skip
    ]);
    const count = await emitWebhookEvent("org-1", "tenant.config.changed", { key: "x" }, store);
    assert.equal(count, 1);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0]?.subscriptionId, "a");
    assert.equal(store.rows[0]?.status, "pending");
    assert.equal(store.rows[0]?.payload, JSON.stringify({ key: "x" }));
  });
});

describe("processDueDeliveries (ADR-0052)", () => {
  it("delivers a due pending delivery and marks it delivered", async () => {
    const store = makeStore([{ id: "a" }]);
    await emitWebhookEvent("org-1", "platform.test", {}, store);
    const deps: WorkerDeps = { store, dispatch: dispatchOk };
    const summary = await processDueDeliveries(deps, { now: new Date(1000) });
    assert.deepEqual(summary, { claimed: 1, delivered: 1, retried: 0, dead: 0 });
    assert.equal(store.rows[0]?.status, "delivered");
    assert.equal(store.rows[0]?.attempt, 1);
  });

  it("retries on failure with backoff, then delivers on a later tick", async () => {
    const store = makeStore([{ id: "a" }]);
    await emitWebhookEvent("org-1", "platform.test", {}, store);
    // Tick 1 fails → rescheduled pending with attempt 1.
    let flip: WebhookDispatchPort = dispatchFail;
    const deps: WorkerDeps = { store, dispatch: { dispatch: (r) => flip.dispatch(r) } };
    const t1 = await processDueDeliveries(deps, {
      now: new Date(1000),
      maxAttempts: 3,
      backoffSeconds: [0, 0, 0],
    });
    assert.deepEqual(t1, { claimed: 1, delivered: 0, retried: 1, dead: 0 });
    assert.equal(store.rows[0]?.status, "pending");
    assert.equal(store.rows[0]?.attempt, 1);
    // Tick 2 succeeds → delivered with attempt 2.
    flip = dispatchOk;
    const t2 = await processDueDeliveries(deps, {
      now: new Date(2000),
      maxAttempts: 3,
      backoffSeconds: [0, 0, 0],
    });
    assert.deepEqual(t2, { claimed: 1, delivered: 1, retried: 0, dead: 0 });
    assert.equal(store.rows[0]?.status, "delivered");
    assert.equal(store.rows[0]?.attempt, 2);
  });

  it("dead-letters after exhausting maxAttempts", async () => {
    const store = makeStore([{ id: "a" }]);
    await emitWebhookEvent("org-1", "platform.test", {}, store);
    const deps: WorkerDeps = { store, dispatch: dispatchFail };
    // maxAttempts=2: tick1 attempt1→retry, tick2 attempt2→dead.
    await processDueDeliveries(deps, { now: new Date(1), maxAttempts: 2, backoffSeconds: [0, 0] });
    assert.equal(store.rows[0]?.status, "pending");
    const t2 = await processDueDeliveries(deps, {
      now: new Date(2),
      maxAttempts: 2,
      backoffSeconds: [0, 0],
    });
    assert.equal(t2.dead, 1);
    assert.equal(store.rows[0]?.status, "dead");
    assert.equal(store.rows[0]?.attempt, 2);
  });

  it("dead-letters a delivery whose subscription was disabled/deleted", async () => {
    const store = makeStore([{ id: "a", enabled: false }]);
    // enqueue directly (emit would skip a disabled sub)
    await store.enqueueDelivery({
      organisationId: "org-1",
      subscriptionId: "a",
      event: "platform.test",
      payload: "{}",
    });
    const summary = await processDueDeliveries(
      { store, dispatch: dispatchOk },
      { now: new Date(1) }
    );
    assert.equal(summary.dead, 1);
    assert.equal(store.rows[0]?.status, "dead");
  });

  it("does not claim rows that are not yet due", async () => {
    const store = makeStore([{ id: "a" }]);
    await emitWebhookEvent("org-1", "platform.test", {}, store);
    store.rows[0]!.nextAttemptAt = new Date(10_000); // due in the future
    const summary = await processDueDeliveries(
      { store, dispatch: dispatchOk },
      { now: new Date(1000) }
    );
    assert.equal(summary.claimed, 0);
    assert.equal(store.rows[0]?.status, "pending");
  });

  it("signs each attempt over <timestamp>.<body> with the subscription secret", async () => {
    const store = makeStore([{ id: "a" }]);
    await emitWebhookEvent("org-1", "platform.test", {}, store);
    let captured: { headers: Record<string, string>; body: string } | null = null;
    const deps: WorkerDeps = {
      store,
      dispatch: {
        async dispatch(req) {
          captured = req;
          return { ok: true, status: 200, error: null };
        },
      },
    };
    await processDueDeliveries(deps, { now: new Date(1700) });
    assert.ok(captured);
    const sig = captured!.headers["x-platform-signature"]!;
    const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sig);
    assert.ok(m);
    const expected = crypto
      .createHmac("sha256", "secret-a")
      .update(`${m![1]}.${captured!.body}`)
      .digest("hex");
    assert.equal(m![2], expected);
    // the body uses the delivery id as a stable event id
    assert.equal(JSON.parse(captured!.body).id, store.rows[0]?.id);
  });
});
