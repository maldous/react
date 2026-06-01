/**
 * Unit tests for ADR-ACT-0143 Slice 4: feature toggle usecase.
 * Pure — no HTTP, no real DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { resolvePermissions } from "@platform/domain-identity";
import { toggleFeature, ALLOWED_FEATURE_KEYS } from "../../src/usecases/features.ts";

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";

function makeAudit(fail = false): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      if (fail) throw new Error("audit fail");
      events.push(e);
    },
    async query() {
      return [];
    },
  };
}

function makePool() {
  const calls: string[] = [];
  const client = {
    escapeIdentifier: (s: string) => `"${s}"`,
    async query(text: string) {
      calls.push(text);
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      },
      async query(t: string) {
        calls.push(t);
        return { rows: [], rowCount: 1 };
      },
    } as never,
  };
}

describe("toggleFeature", () => {
  it("unknown key → unknown_key, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await toggleFeature(
      {
        rawBody: { enabled: true },
        featureKey: "nonexistent",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "unknown_key");
    assert.equal(audit.events.length, 0);
  });

  it("invalid body (missing enabled) → invalid_body, no audit", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await toggleFeature(
      {
        rawBody: {},
        featureKey: "analytics",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("success → ok, FeatureToggled audit BEFORE write", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };
    const { pool, calls } = makePool();

    const result = await toggleFeature(
      {
        rawBody: { enabled: true },
        featureKey: "analytics",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
      },
      { audit, pool }
    );

    assert.equal(result.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.FeatureToggled);
    const writeIdx = calls.findIndex((c) => c.toLowerCase().includes("insert"));
    assert.ok(writeIdx !== -1 && callOrder.indexOf("audit") < writeIdx, "audit before write");
  });

  it("audit failure aborts write", async () => {
    const audit = makeAudit(true);
    const { pool, calls } = makePool();
    await assert.rejects(
      () =>
        toggleFeature(
          {
            rawBody: { enabled: false },
            featureKey: "webhooks",
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ["tenant-admin"],
          },
          { audit, pool }
        ),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.toLowerCase().includes("insert")));
  });

  it("all ALLOWED_FEATURE_KEYS are valid lowercase snake_case", () => {
    assert.ok(ALLOWED_FEATURE_KEYS.length >= 4, "at least 4 feature keys defined");
    for (const k of ALLOWED_FEATURE_KEYS) {
      assert.match(k, /^[a-z_]+$/, `key ${k} must be lowercase snake_case`);
    }
  });
});

describe("feature permission model", () => {
  it("tenant-admin has tenant.features.read and tenant.features.update", () => {
    const perms = resolvePermissions("tenant-admin");
    assert.ok(perms.includes("tenant.features.read"));
    assert.ok(perms.includes("tenant.features.update"));
  });

  it("manager has neither tenant.features.*", () => {
    const perms = resolvePermissions("manager");
    assert.ok(!perms.includes("tenant.features.read"));
    assert.ok(!perms.includes("tenant.features.update"));
  });
});
