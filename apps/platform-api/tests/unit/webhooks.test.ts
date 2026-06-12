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
  getWebhookReadiness,
  listWebhooks,
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
    assert.equal(classifyWebhookReadiness({ total: 0, enabled: 0 }), "no_subscriptions");
    assert.equal(classifyWebhookReadiness({ total: 2, enabled: 1 }), "configured");
    assert.equal(classifyWebhookReadiness({ total: 2, enabled: 0 }), "no_subscriptions");
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
  });
});
