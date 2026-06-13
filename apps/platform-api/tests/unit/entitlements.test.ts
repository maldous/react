import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenError } from "@platform/platform-errors";
import { AuditAction, type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  assertEntitlement,
  evaluateEntitlement,
  isEntitled,
  listEntitlementsForTenant,
  listTenantEntitlements,
  quotaHook,
  setEntitlement,
} from "../../src/usecases/entitlements.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
  UpsertEntitlementInput,
} from "../../src/ports/entitlement-repository.ts";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const ACTOR = { actorId: "op-1", actorRoles: ["system_operator"], sourceHost: "aldous.info" };

function makeRepo(): EntitlementRepository {
  const store = new Map<string, EntitlementGrantRecord>();
  const k = (org: string, key: string) => `${org}:${key}`;
  return {
    listForTenant: async (org) => [...store.values()].filter((r) => r.organisationId === org),
    listForTenantAsOperator: async (org) =>
      [...store.values()].filter((r) => r.organisationId === org),
    getGrant: async (org, key) => store.get(k(org, key)) ?? null,
    upsert: async (input: UpsertEntitlementInput) => {
      const record: EntitlementGrantRecord = {
        organisationId: input.organisationId,
        entitlementKey: input.entitlementKey,
        state: input.state,
        source: input.source,
        metadata: input.metadata ?? {},
        updatedAt: "2026-06-13T00:00:00.000Z",
        updatedBy: input.updatedBy,
      };
      store.set(k(input.organisationId, input.entitlementKey), record);
      return record;
    },
  };
}

function makeAudit(): { port: AuditEventPort; events: AuditEvent[]; failOnce: () => void } {
  const events: AuditEvent[] = [];
  let fail = false;
  return {
    events,
    failOnce: () => {
      fail = true;
    },
    port: {
      emit: async (e) => {
        if (fail) {
          fail = false;
          throw new Error("audit unavailable");
        }
        events.push(e);
      },
      query: async () => events,
    },
  };
}

describe("entitlements usecase", () => {
  it("denies by default — an ungranted key is not entitled and reads not_granted", async () => {
    const deps = { repository: makeRepo(), audit: makeAudit().port };
    assert.equal(await isEntitled(ORG_A, "webhooks", deps), false);
    const list = await listEntitlementsForTenant(ORG_A, deps);
    assert.equal(list.entitlements.find((e) => e.key === "webhooks")?.state, "not_granted");
  });

  it("system operator can grant; grant is audited before the write", async () => {
    const audit = makeAudit();
    const deps = { repository: makeRepo(), audit: audit.port };
    const result = await setEntitlement(
      { organisationId: ORG_A, key: "webhooks", state: "granted", note: "pilot", actor: ACTOR },
      deps
    );
    assert.equal(result.kind, "ok");
    assert.equal(await isEntitled(ORG_A, "webhooks", deps), true);
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]?.action, AuditAction.EntitlementGranted);
    assert.equal(audit.events[0]?.resource, "entitlement");
  });

  it("aborts the grant when the audit write fails (audit-before-change)", async () => {
    const audit = makeAudit();
    const deps = { repository: makeRepo(), audit: audit.port };
    audit.failOnce();
    await assert.rejects(
      setEntitlement(
        { organisationId: ORG_A, key: "storage", state: "granted", actor: ACTOR },
        deps
      )
    );
    assert.equal(await isEntitled(ORG_A, "storage", deps), false);
  });

  it("revokes — a removed entitlement blocks access", async () => {
    const deps = { repository: makeRepo(), audit: makeAudit().port };
    await setEntitlement(
      { organisationId: ORG_A, key: "storage", state: "granted", actor: ACTOR },
      deps
    );
    assert.equal(await isEntitled(ORG_A, "storage", deps), true);
    await setEntitlement(
      { organisationId: ORG_A, key: "storage", state: "revoked", actor: ACTOR },
      deps
    );
    assert.equal(await isEntitled(ORG_A, "storage", deps), false);
  });

  it("is tenant-scoped — a grant for ORG_A does not leak to ORG_B", async () => {
    const deps = { repository: makeRepo(), audit: makeAudit().port };
    await setEntitlement(
      { organisationId: ORG_A, key: "webhooks", state: "granted", actor: ACTOR },
      deps
    );
    assert.equal(await isEntitled(ORG_B, "webhooks", deps), false);
  });

  it("rejects unknown keys — a feature flag is not an entitlement", async () => {
    const audit = makeAudit();
    const deps = { repository: makeRepo(), audit: audit.port };
    const result = await setEntitlement(
      { organisationId: ORG_A, key: "some_feature_flag", state: "granted", actor: ACTOR },
      deps
    );
    assert.equal(result.kind, "unknown_key");
    assert.equal(audit.events.length, 0);
  });

  it("tenant self-read returns the full catalog with deny-by-default states", async () => {
    const deps = { repository: makeRepo(), audit: makeAudit().port };
    await setEntitlement(
      { organisationId: ORG_A, key: "webhooks", state: "granted", actor: ACTOR },
      deps
    );
    const list = await listTenantEntitlements(ORG_A, deps);
    assert.ok(list.entitlements.length >= 4);
    assert.equal(list.entitlements.find((e) => e.key === "webhooks")?.state, "granted");
    assert.equal(list.entitlements.find((e) => e.key === "storage")?.state, "not_granted");
  });

  it("assertEntitlement throws a typed 403 when not entitled", async () => {
    const deps = { repository: makeRepo(), audit: makeAudit().port };
    await assert.rejects(assertEntitlement(ORG_A, "webhooks", deps), ForbiddenError);
    await setEntitlement(
      { organisationId: ORG_A, key: "webhooks", state: "granted", actor: ACTOR },
      deps
    );
    await assert.doesNotReject(assertEntitlement(ORG_A, "webhooks", deps));
  });
});

describe("entitlement policy chain (ADR-0058)", () => {
  it("evaluates in order: permission → entitlement → policy → quota, deny-by-default", async () => {
    const deps = { repository: makeRepo(), audit: makeAudit().port };
    const noPerm = await evaluateEntitlement(
      { organisationId: ORG_A, key: "webhooks", hasPermission: false },
      deps
    );
    assert.equal(noPerm.allowed, false);
    assert.equal(noPerm.decidedBy, "permission");

    const notEntitled = await evaluateEntitlement(
      { organisationId: ORG_A, key: "webhooks", hasPermission: true },
      deps
    );
    assert.equal(notEntitled.allowed, false);
    assert.equal(notEntitled.decidedBy, "entitlement");

    await setEntitlement(
      { organisationId: ORG_A, key: "webhooks", state: "granted", actor: ACTOR },
      deps
    );
    const allowed = await evaluateEntitlement(
      { organisationId: ORG_A, key: "webhooks", hasPermission: true },
      deps
    );
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.decidedBy, "quota");
  });

  it("quota hook is a Phase-1 no-op (never enforces)", () => {
    assert.equal(quotaHook("webhooks").status, "not_enforced");
    assert.equal(quotaHook("unknown").status, "not_applicable");
  });
});
