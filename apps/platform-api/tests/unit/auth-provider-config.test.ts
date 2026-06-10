/**
 * Unit tests for per-tenant authentication provider config (ADR-0037).
 * Pure — no HTTP, no real DB. Covers the storage usecase (tenant_settings) and
 * the tenant-aware resolution helpers in server/auth-providers.ts.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import {
  getStoredTenantAuthProviders,
  setTenantAuthProviders,
} from "../../src/usecases/auth-provider-config.ts";
import {
  listEnabledProviders,
  resolveProviderHint,
  resolveEffectiveMode,
} from "../../src/server/auth-providers.ts";

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

/** Pool whose SELECT on tenant_settings returns `selectRows`; other queries no-op. */
function makePool(selectRows: { value: unknown }[] = []) {
  const calls: string[] = [];
  const client = {
    escapeIdentifier: (s: string) => `"${s}"`,
    async query(text: string) {
      calls.push(text);
      if (text.toLowerCase().includes("select value from tenant_settings")) {
        return { rows: selectRows, rowCount: selectRows.length };
      }
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

describe("getStoredTenantAuthProviders", () => {
  it("returns the parsed config when a valid row exists", async () => {
    const { pool } = makePool([{ value: { mode: "real", enabledProviders: ["google"] } }]);
    const cfg = await getStoredTenantAuthProviders(ORG_ID, pool);
    assert.deepEqual(cfg, { mode: "real", enabledProviders: ["google"] });
  });

  it("returns null when no override is stored", async () => {
    const { pool } = makePool([]);
    assert.equal(await getStoredTenantAuthProviders(ORG_ID, pool), null);
  });

  it("returns null when the stored value is invalid", async () => {
    const { pool } = makePool([{ value: { mode: "bogus", enabledProviders: "nope" } }]);
    assert.equal(await getStoredTenantAuthProviders(ORG_ID, pool), null);
  });
});

describe("setTenantAuthProviders", () => {
  const current = { mode: "default" as const, enabledProviders: ["google", "azure", "apple"] };

  it("invalid body (empty) → invalid_body, no audit, no write", async () => {
    const audit = makeAudit();
    const { pool, calls } = makePool();
    const result = await setTenantAuthProviders(
      {
        rawBody: {},
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
        currentConfig: current,
      },
      { audit, pool }
    );
    assert.equal(result.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
    assert.ok(!calls.some((c) => c.toLowerCase().includes("insert")));
  });

  it("mode-only update merges over current enabledProviders + audits before write", async () => {
    const callOrder: string[] = [];
    const audit = makeAudit();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };
    const { pool, calls } = makePool();
    const result = await setTenantAuthProviders(
      {
        rawBody: { mode: "disabled" },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
        currentConfig: current,
      },
      { audit, pool }
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.config, {
      mode: "disabled",
      enabledProviders: ["google", "azure", "apple"],
    });
    assert.equal(audit.events[0]!.action, AuditAction.AuthSettingsProvidersChanged);
    const writeIdx = calls.findIndex((c) => c.toLowerCase().includes("insert"));
    assert.ok(writeIdx !== -1 && callOrder.indexOf("audit") < writeIdx, "audit before write");
  });

  it("enabledProviders-only update keeps current mode", async () => {
    const audit = makeAudit();
    const { pool } = makePool();
    const result = await setTenantAuthProviders(
      {
        rawBody: { enabledProviders: ["google"] },
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ["tenant-admin"],
        currentConfig: { mode: "real", enabledProviders: [] },
      },
      { audit, pool }
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.config, { mode: "real", enabledProviders: ["google"] });
  });

  it("audit failure aborts the write", async () => {
    const audit = makeAudit(true);
    const { pool, calls } = makePool();
    await assert.rejects(
      () =>
        setTenantAuthProviders(
          {
            rawBody: { mode: "mock" },
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ["tenant-admin"],
            currentConfig: current,
          },
          { audit, pool }
        ),
      /audit fail/
    );
    assert.ok(!calls.some((c) => c.toLowerCase().includes("insert")));
  });
});

describe("tenant-aware provider resolution (auth-providers)", () => {
  const prev = process.env["AUTH_PROVIDER_MODE"];
  before(() => {
    process.env["AUTH_PROVIDER_MODE"] = "mock"; // deterministic: third-party enabled in dev/test
  });
  after(() => {
    if (prev === undefined) delete process.env["AUTH_PROVIDER_MODE"];
    else process.env["AUTH_PROVIDER_MODE"] = prev;
  });

  it("resolveEffectiveMode: 'default' inherits env; explicit overrides", () => {
    assert.equal(resolveEffectiveMode("default"), "mock");
    assert.equal(resolveEffectiveMode(undefined), "mock");
    assert.equal(resolveEffectiveMode("disabled"), "disabled");
    assert.equal(resolveEffectiveMode("real"), "real");
  });

  it("platform is always allowed regardless of tenant config", () => {
    const r = resolveProviderHint("platform", { mode: "disabled", enabledProviders: [] });
    assert.deepEqual(r, { ok: true, id: "platform", idpHint: null });
  });

  it("third-party rejected when not in the tenant allowlist", () => {
    assert.equal(
      resolveProviderHint("google", { mode: "default", enabledProviders: [] }).ok,
      false
    );
    assert.equal(
      resolveProviderHint("google", { mode: "default", enabledProviders: ["google"] }).ok,
      true
    );
  });

  it("third-party rejected when the effective mode is disabled", () => {
    assert.equal(
      resolveProviderHint("google", { mode: "disabled", enabledProviders: ["google"] }).ok,
      false
    );
  });

  it("unknown provider is always rejected", () => {
    assert.equal(resolveProviderHint("evil", undefined).ok, false);
  });

  it("listEnabledProviders honours the tenant allowlist (platform always present)", () => {
    const none = listEnabledProviders({ mode: "default", enabledProviders: [] });
    assert.deepEqual(
      none.map((p) => p.id),
      ["platform"]
    );
    const withGoogle = listEnabledProviders({ mode: "default", enabledProviders: ["google"] });
    assert.ok(withGoogle.some((p) => p.id === "google"));
    assert.ok(withGoogle.some((p) => p.id === "platform"));
    assert.ok(!withGoogle.some((p) => p.id === "azure"));
  });
});
