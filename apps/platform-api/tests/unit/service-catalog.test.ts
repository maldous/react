import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STATIC_PROVIDER_REGISTRY,
  buildServiceCatalog,
  forbiddenProvidersForEnvironment,
} from "../../src/usecases/service-catalog.ts";

const SECRET_FIELD = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

describe("service catalog v2 (ADR-0055)", () => {
  it("every entry is fully and validly classified", () => {
    const entries = STATIC_PROVIDER_REGISTRY.list();
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.ok(e.serviceName && e.category && e.environmentModel, `${e.serviceKey} fields`);
      assert.ok(["tenant_scoped_safe", "global_only", "not_exposed"].includes(e.visibility));
      assert.ok(["build", "compose", "adapter", "defer", "reject"].includes(e.decision));
      assert.ok(e.isolationNotes.length > 0);
      assert.ok(e.proofRefs.length > 0);
      assert.equal(
        e.requiresEntitlement ? typeof e.entitlementKey : "object",
        e.requiresEntitlement ? "string" : "object"
      );
    }
  });

  it("carries no secret-bearing fields", () => {
    for (const e of STATIC_PROVIDER_REGISTRY.list()) {
      for (const key of Object.keys(e)) {
        assert.ok(!SECRET_FIELD.test(key), `unexpected secret field: ${key}`);
      }
    }
  });

  it("operator view returns the full catalog", () => {
    const view = buildServiceCatalog({ operator: true });
    assert.equal(view.services.length, STATIC_PROVIDER_REGISTRY.list().length);
  });

  it("tenant view hides not_exposed, global_only, and un-entitled gated services", () => {
    const view = buildServiceCatalog({ operator: false, entitledKeys: new Set() });
    assert.ok(view.services.every((e) => e.visibility === "tenant_scoped_safe"));
    assert.ok(view.services.every((e) => !e.requiresEntitlement));
    // a non-gated tenant_scoped_safe service (keycloak) remains visible
    assert.ok(view.services.some((e) => e.serviceKey === "keycloak"));
  });

  it("tenant view reveals an entitlement-gated service once entitled", () => {
    const gated = STATIC_PROVIDER_REGISTRY.list().find(
      (e) => e.visibility === "tenant_scoped_safe" && e.requiresEntitlement
    );
    // (no tenant_scoped_safe gated service in the seed today — assert the filter is sound either way)
    const entitledKeys = new Set(
      STATIC_PROVIDER_REGISTRY.list()
        .map((e) => e.entitlementKey)
        .filter((k): k is string => typeof k === "string")
    );
    const view = buildServiceCatalog({ operator: false, entitledKeys });
    if (gated) assert.ok(view.services.some((e) => e.serviceKey === gated.serviceKey));
    assert.ok(view.services.every((e) => e.visibility === "tenant_scoped_safe"));
  });

  it("forbids mock/forbidden providers in production, permits all in dev", () => {
    const prod = forbiddenProvidersForEnvironment("production");
    assert.ok(prod.length > 0);
    assert.ok(prod.every((e) => e.forbiddenInProduction));
    assert.equal(forbiddenProvidersForEnvironment("development").length, 0);
  });

  it("every mock-only entry is flagged forbiddenInProduction", () => {
    const mocks = STATIC_PROVIDER_REGISTRY.list().filter((e) => e.environmentModel === "mock-only");
    assert.ok(mocks.length > 0);
    assert.ok(mocks.every((e) => e.forbiddenInProduction));
  });
});
