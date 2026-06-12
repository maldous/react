/**
 * Unit tests for ADR-0051 / ADR-ACT-0221 — webhooks orchestration + HMAC signing.
 * Pure signing + a fake in-memory store/dispatch/audit. Asserts the reveal-once
 * secret never appears in audit metadata and that payloads are correctly signed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AuditEventPort } from "@platform/audit-events";
import {
  classifyWebhookReadiness,
  createWebhook,
  getSubscriptionMetrics,
  getWebhookReadiness,
  listWebhooks,
  redriveDeadDeliveries,
  rotateWebhookSecret,
  signWebhookBody,
  testWebhook,
  updateWebhook,
  webhookSignatureHeader,
  type WebhookDispatchPort,
  type WebhookDispatchResult,
} from "../../src/usecases/webhooks.ts";
import type {
  CreateWebhookInput,
  RecordDeliveryInput,
  UpdateWebhookFields,
  WebhookDeliveryRecord,
  WebhookStore,
  WebhookSubscriptionRecord,
} from "../../src/ports/webhook-store.ts";

// --- fakes ---------------------------------------------------------------
function makeStore(): WebhookStore & {
  secrets: Map<string, string>;
  deliveries: RecordDeliveryInput[];
} {
  const subs = new Map<string, WebhookSubscriptionRecord & { organisationId: string }>();
  const secrets = new Map<string, string>();
  const deliveries: RecordDeliveryInput[] = [];
  let n = 0;
  return {
    secrets,
    deliveries,
    async list(orgId) {
      return [...subs.values()].filter((s) => s.organisationId === orgId);
    },
    async get(orgId, id) {
      const s = subs.get(id);
      return s && s.organisationId === orgId ? s : null;
    },
    async create(input: CreateWebhookInput) {
      const id = `id-${++n}`;
      const rec: WebhookSubscriptionRecord & { organisationId: string } = {
        organisationId: input.organisationId,
        id,
        url: input.url,
        enabled: input.enabled,
        eventTypes: input.eventTypes,
        hasSecret: true,
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
      };
      subs.set(id, rec);
      secrets.set(id, input.secret);
      return rec;
    },
    async update(orgId, id, fields: UpdateWebhookFields) {
      const s = subs.get(id);
      if (!s || s.organisationId !== orgId) return null;
      if (fields.url !== undefined) s.url = fields.url;
      if (fields.eventTypes !== undefined) s.eventTypes = fields.eventTypes;
      if (fields.enabled !== undefined) s.enabled = fields.enabled;
      return s;
    },
    async delete(orgId, id) {
      const s = subs.get(id);
      if (!s || s.organisationId !== orgId) return false;
      subs.delete(id);
      return true;
    },
    async rotateSecret(orgId, id, secret) {
      const s = subs.get(id);
      if (!s || s.organisationId !== orgId) return false;
      secrets.set(id, secret);
      return true;
    },
    async getSecret(orgId, id) {
      const s = subs.get(id);
      return s && s.organisationId === orgId ? (secrets.get(id) ?? null) : null;
    },
    async recordDelivery(input) {
      deliveries.push(input);
    },
    async listDeliveries(): Promise<WebhookDeliveryRecord[]> {
      return [];
    },
    async counts(orgId) {
      const all = [...subs.values()].filter((s) => s.organisationId === orgId);
      return { total: all.length, enabled: all.filter((s) => s.enabled).length };
    },
    async subscriptionMetrics() {
      return {
        total: 0,
        delivered: 0,
        failed: 0,
        dead: 0,
        pending: 0,
        lastStatus: null,
        lastDeliveryAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
    },
    async deadDeliveryCount() {
      return 0;
    },
    async redriveDeadDelivery() {
      return false;
    },
    async redriveDeadForSubscription() {
      return 0;
    },
  };
}

function makeAudit(): AuditEventPort & { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    async emit(e) {
      events.push(e as Record<string, unknown>);
    },
  };
}

const ACTOR = { actorId: "user-1", actorRoles: ["tenant-admin"] };
const ORG = "org-1";

// --- pure signing --------------------------------------------------------
describe("HMAC signing (ADR-0051)", () => {
  it("signs <timestamp>.<body> with HMAC-SHA-256 and is verifiable", () => {
    const sig = signWebhookBody("whsec_abc", 1000, "{}");
    const expected = crypto.createHmac("sha256", "whsec_abc").update("1000.{}").digest("hex");
    assert.equal(sig, expected);
  });
  it("header carries the replay timestamp + v1 signature", () => {
    assert.equal(webhookSignatureHeader("s", 42, "b"), `t=42,v1=${signWebhookBody("s", 42, "b")}`);
  });
});

describe("classifyWebhookReadiness", () => {
  it("no subs → no_subscriptions; ≥1 enabled → configured; subs but none enabled → no_subscriptions", () => {
    assert.equal(classifyWebhookReadiness({ total: 0, enabled: 0, dead: 0 }), "no_subscriptions");
    assert.equal(classifyWebhookReadiness({ total: 2, enabled: 1, dead: 0 }), "configured");
    assert.equal(classifyWebhookReadiness({ total: 2, enabled: 0, dead: 0 }), "no_subscriptions");
  });
  it("dead deliveries → has_dead_deliveries (ADR-ACT-0226)", () => {
    assert.equal(
      classifyWebhookReadiness({ total: 2, enabled: 1, dead: 3 }),
      "has_dead_deliveries"
    );
  });
});

describe("createWebhook (ADR-0051)", () => {
  it("reveals the secret once, stores it, and NEVER puts it in audit metadata", async () => {
    const store = makeStore();
    const audit = makeAudit();
    const res = await createWebhook(
      {
        organisationId: ORG,
        data: { url: "https://x.test/hook", eventTypes: ["platform.test"] },
        actor: ACTOR,
      },
      { store, audit, genSecret: () => "whsec_TESTSECRET" }
    );
    assert.equal(res.secret, "whsec_TESTSECRET");
    assert.equal(res.subscription.hasSecret, true);
    assert.equal(res.subscription.url, "https://x.test/hook");
    // the secret is stored
    assert.equal(store.secrets.get(res.subscription.id), "whsec_TESTSECRET");
    // audit-first, and the secret never appears anywhere in audit metadata
    assert.equal(audit.events.length, 1);
    const blob = JSON.stringify(audit.events[0]);
    assert.ok(!blob.includes("whsec_TESTSECRET"), "secret must not be in audit metadata");
    assert.ok(blob.includes("https://x.test/hook"));
  });
});

describe("rotateWebhookSecret (ADR-0051)", () => {
  it("returns a new secret, replaces the stored one, no secret in audit", async () => {
    const store = makeStore();
    const audit = makeAudit();
    const created = await createWebhook(
      {
        organisationId: ORG,
        data: { url: "https://x.test/h", eventTypes: ["platform.test"] },
        actor: ACTOR,
      },
      { store, audit, genSecret: () => "old" }
    );
    const rot = await rotateWebhookSecret(
      { organisationId: ORG, id: created.subscription.id, actor: ACTOR },
      { store, audit, genSecret: () => "new_secret" }
    );
    assert.equal(rot.kind === "ok" && rot.secret, "new_secret");
    assert.equal(store.secrets.get(created.subscription.id), "new_secret");
    assert.ok(!JSON.stringify(audit.events).includes("new_secret"));
  });
  it("not_found for an unknown id", async () => {
    const r = await rotateWebhookSecret(
      { organisationId: ORG, id: "missing", actor: ACTOR },
      { store: makeStore(), audit: makeAudit() }
    );
    assert.equal(r.kind, "not_found");
  });
});

describe("updateWebhook", () => {
  it("not_found for an unknown id", async () => {
    const r = await updateWebhook(
      { organisationId: ORG, id: "missing", data: { enabled: false }, actor: ACTOR },
      { store: makeStore(), audit: makeAudit() }
    );
    assert.equal(r.kind, "not_found");
  });
});

describe("testWebhook (ADR-0051)", () => {
  it("dispatches a signed platform.test payload and records a delivery", async () => {
    const store = makeStore();
    const audit = makeAudit();
    const created = await createWebhook(
      {
        organisationId: ORG,
        data: { url: "https://x.test/h", eventTypes: ["platform.test"] },
        actor: ACTOR,
      },
      { store, audit, genSecret: () => "whsec_K" }
    );
    let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
    const dispatch: WebhookDispatchPort = {
      async dispatch(req): Promise<WebhookDispatchResult> {
        captured = req;
        return { ok: true, status: 200, error: null };
      },
    };
    const r = await testWebhook(
      { organisationId: ORG, id: created.subscription.id, actor: ACTOR, now: 1700000000000 },
      { store, audit, dispatch }
    );
    assert.equal(r.kind === "ok" && r.result.status, "delivered");
    assert.equal(r.kind === "ok" && r.result.responseStatus, 200);
    assert.ok(captured, "dispatch was called");
    const sigHeader = captured!.headers["x-platform-signature"]!;
    // the signature verifies against the stored secret + body
    assert.equal(sigHeader, webhookSignatureHeader("whsec_K", 1700000000000, captured!.body));
    assert.equal(captured!.headers["x-platform-event"], "platform.test");
    // a delivery row was recorded as delivered
    assert.equal(store.deliveries.at(-1)?.status, "delivered");
    // the secret is not in the body or audit
    assert.ok(!captured!.body.includes("whsec_K"));
    assert.ok(!JSON.stringify(audit.events).includes("whsec_K"));
  });

  it("classifies a failed dispatch and records a failed delivery (no throw escapes)", async () => {
    const store = makeStore();
    const audit = makeAudit();
    const created = await createWebhook(
      {
        organisationId: ORG,
        data: { url: "https://x.test/h", eventTypes: ["platform.test"] },
        actor: ACTOR,
      },
      { store, audit, genSecret: () => "k" }
    );
    const dispatch: WebhookDispatchPort = {
      async dispatch() {
        throw new Error("ECONNREFUSED");
      },
    };
    const r = await testWebhook(
      { organisationId: ORG, id: created.subscription.id, actor: ACTOR },
      { store, audit, dispatch }
    );
    assert.equal(r.kind === "ok" && r.result.status, "failed");
    assert.equal(store.deliveries.at(-1)?.status, "failed");
  });

  it("not_found for an unknown subscription", async () => {
    const r = await testWebhook(
      { organisationId: ORG, id: "missing", actor: ACTOR },
      {
        store: makeStore(),
        audit: makeAudit(),
        dispatch: {
          async dispatch() {
            return { ok: true, status: 200, error: null };
          },
        },
      }
    );
    assert.equal(r.kind, "not_found");
  });
});

describe("listWebhooks + getWebhookReadiness", () => {
  it("lists summaries (never a secret field) and aggregates readiness", async () => {
    const store = makeStore();
    const audit = makeAudit();
    await createWebhook(
      {
        organisationId: ORG,
        data: { url: "https://x.test/h", eventTypes: ["platform.test"], enabled: true },
        actor: ACTOR,
      },
      { store, audit }
    );
    const list = await listWebhooks(ORG, store);
    assert.equal(list.length, 1);
    assert.ok(!("secret" in list[0]!), "list entries must not carry a secret");
    const readiness = await getWebhookReadiness(ORG, store);
    assert.equal(readiness.status, "configured");
    assert.equal(readiness.total, 1);
    assert.equal(readiness.enabled, 1);
    assert.equal(readiness.deadDeliveries, 0);
  });
});

// --- metrics + dead-letter redrive (ADR-ACT-0226) ----------------------------
// A status-aware fake store: one subscription "sub-1" + a mutable delivery list.
function makeMetricsStore(deliveries: Array<{ id: string; status: string }>) {
  const redriven: string[] = [];
  const store = {
    redriven,
    async get(_org: string, id: string) {
      return id === "sub-1" ? { id, url: "https://x", enabled: true } : null;
    },
    async subscriptionMetrics() {
      const by = (s: string) => deliveries.filter((d) => d.status === s).length;
      return {
        total: deliveries.length,
        delivered: by("delivered"),
        failed: by("failed"),
        dead: by("dead"),
        pending: by("pending"),
        lastStatus: deliveries.at(-1)?.status ?? null,
        lastDeliveryAt: deliveries.length ? "2026-06-12T00:00:00Z" : null,
        lastSuccessAt: by("delivered") ? "2026-06-12T00:00:00Z" : null,
        lastFailureAt: by("dead") + by("failed") ? "2026-06-12T00:00:00Z" : null,
      };
    },
    async deadDeliveryCount() {
      return deliveries.filter((d) => d.status === "dead").length;
    },
    async redriveDeadDelivery(_org: string, deliveryId: string) {
      const d = deliveries.find((x) => x.id === deliveryId && x.status === "dead");
      if (!d) return false;
      d.status = "pending";
      redriven.push(deliveryId);
      return true;
    },
    async redriveDeadForSubscription() {
      const dead = deliveries.filter((d) => d.status === "dead");
      dead.forEach((d) => (d.status = "pending"));
      return dead.length;
    },
  };
  return store as unknown as import("../../src/ports/webhook-store.ts").WebhookStore & {
    redriven: string[];
  };
}

describe("getSubscriptionMetrics (ADR-ACT-0226)", () => {
  it("returns safe counts + last-status metadata for a known subscription", async () => {
    const store = makeMetricsStore([
      { id: "d1", status: "delivered" },
      { id: "d2", status: "dead" },
      { id: "d3", status: "pending" },
    ]);
    const m = await getSubscriptionMetrics(ORG, "sub-1", store);
    assert.equal(m?.subscriptionId, "sub-1");
    assert.equal(m?.total, 3);
    assert.equal(m?.delivered, 1);
    assert.equal(m?.dead, 1);
    assert.equal(m?.pending, 1);
    assert.equal(m?.lastSuccessAt !== null, true);
    // no payload/secret/headers fields leak into the metrics DTO
    assert.ok(!("payload" in (m as object)) && !("secret" in (m as object)));
  });
  it("returns null for an unknown subscription", async () => {
    const m = await getSubscriptionMetrics(ORG, "nope", makeMetricsStore([]));
    assert.equal(m, null);
  });
});

describe("redriveDeadDeliveries (ADR-ACT-0226)", () => {
  it("requeues a single dead delivery (audit-first, no secret in audit)", async () => {
    const store = makeMetricsStore([{ id: "d-dead", status: "dead" }]);
    const audit = makeAudit();
    const r = await redriveDeadDeliveries(
      { organisationId: ORG, subscriptionId: "sub-1", deliveryId: "d-dead", actor: ACTOR },
      { store, audit }
    );
    assert.equal(r.kind === "ok" && r.redriven, 1);
    assert.deepEqual(store.redriven, ["d-dead"]);
    assert.equal(audit.events.length, 1);
    assert.ok(!JSON.stringify(audit.events).toLowerCase().includes("secret"));
  });
  it("is idempotent — redriving a non-dead/unknown delivery requeues 0", async () => {
    const store = makeMetricsStore([{ id: "d-ok", status: "delivered" }]);
    const r = await redriveDeadDeliveries(
      { organisationId: ORG, subscriptionId: "sub-1", deliveryId: "d-ok", actor: ACTOR },
      { store, audit: makeAudit() }
    );
    assert.equal(r.kind === "ok" && r.redriven, 0);
  });
  it("bulk redrive requeues all dead deliveries for the subscription", async () => {
    const store = makeMetricsStore([
      { id: "a", status: "dead" },
      { id: "b", status: "dead" },
      { id: "c", status: "delivered" },
    ]);
    const r = await redriveDeadDeliveries(
      { organisationId: ORG, subscriptionId: "sub-1", actor: ACTOR },
      { store, audit: makeAudit() }
    );
    assert.equal(r.kind === "ok" && r.redriven, 2);
  });
  it("not_found for an unknown subscription", async () => {
    const r = await redriveDeadDeliveries(
      { organisationId: ORG, subscriptionId: "missing", deliveryId: "x", actor: ACTOR },
      { store: makeMetricsStore([]), audit: makeAudit() }
    );
    assert.equal(r.kind, "not_found");
  });
});
