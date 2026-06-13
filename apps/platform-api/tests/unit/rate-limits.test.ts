import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  assertRateLimit,
  evaluateRateLimit,
  listRateLimits,
  setRateLimit,
} from "../../src/usecases/rate-limits.ts";
import type {
  RateLimitPolicyRecord,
  RateLimitRepository,
  UpsertRateLimitInput,
} from "../../src/ports/rate-limit-repository.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
} from "../../src/ports/entitlement-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = { actorId: "op", actorRoles: ["system-admin"] };

function fakeEntitlements(granted: boolean): EntitlementRepository {
  const rec: EntitlementGrantRecord = {
    organisationId: ORG,
    entitlementKey: "api_access",
    state: granted ? "granted" : "revoked",
    source: "system",
    metadata: {},
    updatedAt: null,
    updatedBy: null,
  };
  return {
    listForTenant: async () => [],
    listForTenantAsOperator: async () => [],
    getGrant: async () => (granted ? rec : null),
    upsert: async () => rec,
  };
}

function fakeRateLimits(initial?: RateLimitPolicyRecord): RateLimitRepository {
  let row = initial ?? null;
  const counters = new Map<string, number>();
  return {
    getByKey: async (_o, k) => (row && row.policyKey === k ? row : null),
    listForTenant: async () => (row ? [row] : []),
    listForTenantAsOperator: async () => (row ? [row] : []),
    upsert: async (i: UpsertRateLimitInput) => {
      row = {
        policyKey: i.policyKey,
        entitlementKey: i.entitlementKey,
        limit: i.limit,
        windowSeconds: i.windowSeconds,
        action: i.action,
        updatedAt: null,
        updatedBy: i.updatedBy,
      };
    },
    incrementAndCount: async (_o, k) => {
      const c = (counters.get(k) ?? 0) + 1;
      counters.set(k, c);
      return c;
    },
    currentCount: async (_o, k) => counters.get(k) ?? 0,
  };
}

function capturingAudit(): { port: AuditEventPort; events: AuditEvent[]; fail: () => void } {
  const events: AuditEvent[] = [];
  let f = false;
  return {
    events,
    fail: () => (f = true),
    port: {
      emit: async (e) => {
        if (f) throw new Error("audit down");
        events.push(e);
      },
      query: async () => events,
    },
  };
}

const policy: RateLimitPolicyRecord = {
  policyKey: "api.requests",
  entitlementKey: "api_access",
  limit: 2,
  windowSeconds: 60,
  action: "deny",
  updatedAt: null,
  updatedBy: null,
};

describe("rate-limits usecase", () => {
  it("allows when no policy is configured (opt-in)", async () => {
    const deps = {
      rateLimits: fakeRateLimits(),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    const r = await evaluateRateLimit(ORG, "api.requests", deps);
    assert.equal(r.allowed, true);
    assert.equal(r.decidedBy, "no_policy");
  });

  it("denies at the entitlement step (bridge) before counting", async () => {
    const deps = {
      rateLimits: fakeRateLimits(policy),
      entitlements: fakeEntitlements(false),
      audit: capturingAudit().port,
    };
    const r = await evaluateRateLimit(ORG, "api.requests", deps);
    assert.equal(r.allowed, false);
    assert.equal(r.decidedBy, "entitlement");
    assert.equal(r.used, 0);
  });

  it("allows below the limit and denies above it within the window", async () => {
    const deps = {
      rateLimits: fakeRateLimits(policy),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    const r1 = await evaluateRateLimit(ORG, "api.requests", deps);
    const r2 = await evaluateRateLimit(ORG, "api.requests", deps);
    const r3 = await evaluateRateLimit(ORG, "api.requests", deps);
    assert.equal(r1.allowed, true);
    assert.equal(r2.allowed, true);
    assert.equal(r3.allowed, false, "third call exceeds limit=2");
    assert.equal(r3.state, "exceeded");
  });

  it("assertRateLimit throws a typed error once exceeded", async () => {
    const deps = {
      rateLimits: fakeRateLimits(policy),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    await assertRateLimit(ORG, "api.requests", deps);
    await assertRateLimit(ORG, "api.requests", deps);
    await assert.rejects(assertRateLimit(ORG, "api.requests", deps));
  });

  it("setRateLimit is audited (audit-before-change)", async () => {
    const audit = capturingAudit();
    const deps = {
      rateLimits: fakeRateLimits(),
      entitlements: fakeEntitlements(true),
      audit: audit.port,
    };
    await setRateLimit(
      {
        organisationId: ORG,
        policyKey: "api.requests",
        entitlementKey: "api_access",
        limit: 100,
        windowSeconds: 60,
        actor: ACTOR,
      },
      deps
    );
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]?.resource, "rate_limit");
    const listed = await listRateLimits(ORG, deps);
    assert.equal(listed.policies.length, 1);
    assert.equal(listed.policies[0]?.policyKey, "api.requests");
  });
});
