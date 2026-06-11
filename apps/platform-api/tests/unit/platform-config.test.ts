/**
 * Unit tests for the Platform Configuration Registry usecases (ADR-0039) and the
 * feature-flag backwards-compatibility bridge (ADR-ACT-0207 Phase 4). Pure — no DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import {
  listEffectiveTenantConfig,
  setTenantConfigValue,
  clearTenantConfigOverride,
} from "../../src/usecases/platform-config.ts";
import { PLATFORM_CONFIG_DEFINITIONS } from "../../src/config/registry.ts";
import { ALLOWED_FEATURE_KEYS } from "../../src/usecases/features.ts";

const ORG = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR = "a1b2c3d4-e5f6-4000-8000-000000000002";
const ADMIN_PERMS = [
  "tenant.config.read",
  "tenant.config.write",
  "tenant.features.read",
  "tenant.features.update",
];

function makeAudit(opts: { shouldFail?: boolean } = {}): AuditEventPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(e) {
      if (opts.shouldFail) throw new Error("audit unavailable");
      events.push(e);
    },
    async query() {
      return [];
    },
  };
}

function makeSpyPool(stored: Record<string, unknown> = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  function route(text: string, values?: unknown[]) {
    const t = text.toLowerCase();
    if (t.includes("select key, value from tenant_settings where key = any")) {
      const keys = (values?.[0] as string[]) ?? [];
      return {
        rows: keys.filter((k) => k in stored).map((k) => ({ key: k, value: stored[k] })),
        rowCount: 0,
      };
    }
    if (t.includes("select value from tenant_settings where key = $1")) {
      const k = values?.[0] as string;
      return { rows: k in stored ? [{ value: stored[k] }] : [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  }
  const client = {
    escapeIdentifier: (s: string) => `"${s}"`,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return route(text, values);
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return route(text, values);
    },
  } as never;
  return { calls, pool };
}

describe("listEffectiveTenantConfig", () => {
  it("returns every readable definition at its default when no override exists", async () => {
    const { pool } = makeSpyPool();
    const items = await listEffectiveTenantConfig(
      { organisationId: ORG, actorPermissions: ADMIN_PERMS },
      pool
    );
    assert.equal(items.length, PLATFORM_CONFIG_DEFINITIONS.length);
    assert.ok(items.every((i) => i.source === "default"));
    const appName = items.find((i) => i.definition.key === "branding.app_name");
    assert.equal(appName?.value, "Enterprise Platform");
  });

  it("reflects a tenant override (source tenant_override)", async () => {
    const { pool } = makeSpyPool({ "config.branding.app_name": "Acme" });
    const items = await listEffectiveTenantConfig(
      { organisationId: ORG, actorPermissions: ADMIN_PERMS },
      pool
    );
    const appName = items.find((i) => i.definition.key === "branding.app_name");
    assert.equal(appName?.value, "Acme");
    assert.equal(appName?.source, "tenant_override");
  });

  it("filters out definitions the actor cannot read", async () => {
    const { pool } = makeSpyPool();
    // Only features-read ⇒ only feature definitions appear, no config.* ones.
    const items = await listEffectiveTenantConfig(
      { organisationId: ORG, actorPermissions: ["tenant.features.read"] },
      pool
    );
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => i.definition.category === "features"));
  });

  it("honours the category filter", async () => {
    const { pool } = makeSpyPool();
    const items = await listEffectiveTenantConfig(
      { organisationId: ORG, actorPermissions: ADMIN_PERMS, category: "branding" },
      pool
    );
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => i.definition.category === "branding"));
  });

  it("reads a feature flag through its legacy feature.<key> storage (compat)", async () => {
    const { pool } = makeSpyPool({ "feature.analytics": { enabled: true } });
    const items = await listEffectiveTenantConfig(
      { organisationId: ORG, actorPermissions: ADMIN_PERMS, category: "features" },
      pool
    );
    const analytics = items.find((i) => i.definition.key === "features.analytics");
    assert.equal(analytics?.value, true);
    assert.equal(analytics?.source, "tenant_override");
  });
});

describe("setTenantConfigValue", () => {
  it("rejects an unknown key", async () => {
    const { pool } = makeSpyPool();
    const r = await setTenantConfigValue(
      {
        organisationId: ORG,
        key: "nope.nope",
        rawBody: { value: 1 },
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ADMIN_PERMS,
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "not_found");
  });

  it("rejects an enum value outside allowedValues (no audit)", async () => {
    const audit = makeAudit();
    const { pool } = makeSpyPool();
    const r = await setTenantConfigValue(
      {
        organisationId: ORG,
        key: "branding.theme",
        rawBody: { value: "blue" },
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ADMIN_PERMS,
      },
      { audit, pool }
    );
    assert.equal(r.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("forbids writing without the definition's requiredPermissionWrite", async () => {
    const { pool } = makeSpyPool();
    const r = await setTenantConfigValue(
      // features.analytics needs tenant.features.update, which this actor lacks.
      {
        organisationId: ORG,
        key: "features.analytics",
        rawBody: { value: true },
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ["tenant.config.read", "tenant.config.write"],
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "forbidden");
  });

  it("sets a value, auditing before the write", async () => {
    const order: string[] = [];
    const audit = makeAudit();
    const orig = audit.emit.bind(audit);
    audit.emit = async (e) => {
      order.push("audit");
      return orig(e);
    };
    const { pool, calls } = makeSpyPool();
    const r = await setTenantConfigValue(
      {
        organisationId: ORG,
        key: "branding.app_name",
        rawBody: { value: "Acme" },
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ADMIN_PERMS,
      },
      { audit, pool }
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.ConfigValueChanged);
    const insert = calls.find((c) => c.text.toLowerCase().includes("insert into tenant_settings"));
    assert.ok(insert, "expected an upsert");
    assert.equal(insert!.values?.[0], "config.branding.app_name");
    assert.ok(order.indexOf("audit") === 0, "audit before write");
  });

  it("writes a feature flag back to its legacy feature.<key> = {enabled} storage (compat)", async () => {
    const { pool, calls } = makeSpyPool();
    const r = await setTenantConfigValue(
      {
        organisationId: ORG,
        key: "features.analytics",
        rawBody: { value: true },
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ADMIN_PERMS,
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "ok");
    const insert = calls.find((c) => c.text.toLowerCase().includes("insert into tenant_settings"));
    assert.equal(insert!.values?.[0], "feature.analytics");
    assert.deepEqual(JSON.parse(insert!.values?.[1] as string), { enabled: true });
  });
});

describe("clearTenantConfigOverride", () => {
  it("clears an override (audit-first delete)", async () => {
    const audit = makeAudit();
    const { pool, calls } = makeSpyPool();
    const r = await clearTenantConfigOverride(
      {
        organisationId: ORG,
        key: "branding.app_name",
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ADMIN_PERMS,
      },
      { audit, pool }
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events[0]!.action, AuditAction.ConfigValueCleared);
    assert.ok(calls.some((c) => c.text.toLowerCase().includes("delete from tenant_settings")));
  });

  it("returns not_found for an unknown key", async () => {
    const { pool } = makeSpyPool();
    const r = await clearTenantConfigOverride(
      {
        organisationId: ORG,
        key: "nope",
        actorId: ACTOR,
        actorRoles: [],
        actorPermissions: ADMIN_PERMS,
      },
      { audit: makeAudit(), pool }
    );
    assert.equal(r.kind, "not_found");
  });
});

describe("registry feature coverage (drift)", () => {
  it("every ALLOWED_FEATURE_KEYS has a registry definition under features.<key>", () => {
    for (const k of ALLOWED_FEATURE_KEYS) {
      assert.ok(
        PLATFORM_CONFIG_DEFINITIONS.some((d) => d.key === `features.${k}`),
        `missing registry definition for feature ${k}`
      );
    }
  });
});
