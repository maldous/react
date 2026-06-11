/**
 * Unit tests for ADR-0045 / ADR-ACT-0213 — capability registry + readiness.
 * Pure: buildTenantReadiness is a deterministic function of the gathered signals.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES,
  buildTenantReadiness,
  type ReadinessSignals,
} from "../../src/usecases/capability-registry.ts";

const FULLY_READY: ReadinessSignals = {
  authCredential: "configured",
  activeAdminCount: 2,
  idpCount: 1,
};

function cap(resp: ReturnType<typeof buildTenantReadiness>, key: string) {
  return resp.capabilities.find((c) => c.key === key);
}

describe("CAPABILITIES registry", () => {
  it("enumerates the expected enterprise capabilities", () => {
    const keys = new Set(CAPABILITIES.map((c) => c.key));
    for (const expected of [
      "tenant_record",
      "tenant_fqdn",
      "tenant_admin",
      "auth_credential",
      "auth_providers",
      "session_policy",
      "mfa_policy",
      "idp_configuration",
      "feature_config",
      "branding",
      "tenant_domains",
      "email_sender",
      "audit",
      "storage",
      "integrations_webhooks",
      "observability",
    ]) {
      assert.ok(keys.has(expected), `missing capability ${expected}`);
    }
  });

  it("includes the deferred OIDC-enterprise sub-capabilities in the map", () => {
    const keys = new Set(CAPABILITIES.map((c) => c.key));
    for (const k of [
      "oidc_discovery",
      "oidc_issuer_validation",
      "oidc_jwks_validation",
      "oidc_claim_mapping",
      "oidc_group_role_mapping",
      "oidc_test_connection",
      "oidc_callback_display",
      "oidc_login_simulation",
    ]) {
      assert.ok(keys.has(k), `missing OIDC capability ${k}`);
      const c = CAPABILITIES.find((x) => x.key === k)!;
      assert.equal(c.implementationStatus, "deferred");
    }
  });

  it("has unique keys", () => {
    assert.equal(new Set(CAPABILITIES.map((c) => c.key)).size, CAPABILITIES.length);
  });
});

describe("buildTenantReadiness — aggregation", () => {
  it("a fully-configured tenant is overall ready", () => {
    const r = buildTenantReadiness(FULLY_READY);
    assert.equal(r.overall, "ready");
    assert.equal(cap(r, "auth_credential")?.readiness, "ready");
    assert.equal(cap(r, "session_policy")?.readiness, "ready");
    assert.equal(cap(r, "idp_configuration")?.readiness, "ready");
  });

  it("a missing credential blocks the tenant; session/mfa become unknown", () => {
    const r = buildTenantReadiness({
      ...FULLY_READY,
      authCredential: "missing_credential",
      idpCount: null,
    });
    assert.equal(cap(r, "auth_credential")?.readiness, "blocked");
    assert.equal(cap(r, "session_policy")?.readiness, "unknown");
    assert.equal(cap(r, "mfa_policy")?.readiness, "unknown");
    assert.equal(r.overall, "blocked");
  });

  it("an invalid credential degrades the tenant", () => {
    const r = buildTenantReadiness({
      ...FULLY_READY,
      authCredential: "invalid_credential",
      idpCount: null,
    });
    assert.equal(cap(r, "auth_credential")?.readiness, "degraded");
    assert.equal(r.overall, "degraded");
  });

  it("no active tenant-admin blocks the tenant", () => {
    const r = buildTenantReadiness({ ...FULLY_READY, activeAdminCount: 0 });
    assert.equal(cap(r, "tenant_admin")?.readiness, "blocked");
    assert.equal(r.overall, "blocked");
  });

  it("zero IdPs is incomplete but NON-blocking (optional capability)", () => {
    const r = buildTenantReadiness({ ...FULLY_READY, idpCount: 0 });
    assert.equal(cap(r, "idp_configuration")?.readiness, "incomplete");
    assert.equal(cap(r, "idp_configuration")?.required, false);
    assert.equal(r.overall, "ready"); // optional → does not drag overall down
  });

  it("never fakes readiness: deferred capabilities are always 'deferred'", () => {
    for (const signals of [
      FULLY_READY,
      { authCredential: "missing_credential" as const, activeAdminCount: 0, idpCount: null },
    ]) {
      const r = buildTenantReadiness(signals);
      for (const key of ["storage", "tenant_domains", "email_sender", "oidc_discovery"]) {
        assert.equal(cap(r, key)?.readiness, "deferred", `${key} must stay deferred`);
      }
    }
  });

  it("exposes i18n keys + admin routes for the UI to render", () => {
    const r = buildTenantReadiness(FULLY_READY);
    const auth = cap(r, "auth_providers")!;
    assert.equal(auth.labelKey, "feature.admin.readiness.cap.auth_providers.label");
    assert.equal(auth.adminRoute, "/admin/auth");
    assert.equal(cap(r, "auth_credential")?.adminRoute, null); // system-admin / API-first
  });
});
