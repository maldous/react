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
  emailSender: "configured",
  domainReadiness: "verified",
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

  it("exposes the OIDC-enterprise sub-capabilities with honest statuses (ADR-0046)", () => {
    const expected: Record<string, "implemented" | "partial" | "deferred"> = {
      oidc_discovery: "implemented",
      oidc_issuer_validation: "implemented",
      oidc_jwks_validation: "implemented",
      oidc_callback_display: "implemented",
      oidc_test_connection: "implemented",
      oidc_claim_mapping: "partial",
      oidc_group_role_mapping: "partial",
      oidc_login_simulation: "deferred",
    };
    const keys = new Set(CAPABILITIES.map((c) => c.key));
    for (const [k, status] of Object.entries(expected)) {
      assert.ok(keys.has(k), `missing OIDC capability ${k}`);
      assert.equal(
        CAPABILITIES.find((x) => x.key === k)!.implementationStatus,
        status,
        `${k} should be ${status}`
      );
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

  it("email sender readiness reflects its signal honestly (ADR-0047)", () => {
    const ready = buildTenantReadiness({ ...FULLY_READY, emailSender: "configured" });
    assert.equal(cap(ready, "email_sender")?.readiness, "ready");
    assert.equal(cap(ready, "email_sender")?.implementationStatus, "implemented");
    assert.equal(cap(ready, "email_sender")?.required, false);

    assert.equal(
      cap(buildTenantReadiness({ ...FULLY_READY, emailSender: "missing_sender" }), "email_sender")
        ?.readiness,
      "incomplete"
    );
    assert.equal(
      cap(
        buildTenantReadiness({ ...FULLY_READY, emailSender: "missing_credential" }),
        "email_sender"
      )?.readiness,
      "incomplete"
    );
    assert.equal(
      cap(
        buildTenantReadiness({ ...FULLY_READY, emailSender: "invalid_credential" }),
        "email_sender"
      )?.readiness,
      "degraded"
    );
    assert.equal(
      cap(buildTenantReadiness({ ...FULLY_READY, emailSender: "unknown" }), "email_sender")
        ?.readiness,
      "unknown"
    );
    // optional capability → never drags the overall status down.
    assert.equal(
      buildTenantReadiness({ ...FULLY_READY, emailSender: "missing_credential" }).overall,
      "ready"
    );
  });

  it("custom-domain readiness reflects its signal honestly (ADR-0048)", () => {
    const verified = buildTenantReadiness({ ...FULLY_READY, domainReadiness: "verified" });
    assert.equal(cap(verified, "tenant_domains")?.readiness, "ready");
    // honestly partial: TLS issuance + live routing are not verified this pass.
    assert.equal(cap(verified, "tenant_domains")?.implementationStatus, "partial");
    assert.equal(cap(verified, "tenant_domains")?.required, false);

    assert.equal(
      cap(buildTenantReadiness({ ...FULLY_READY, domainReadiness: "no_domains" }), "tenant_domains")
        ?.readiness,
      "incomplete"
    );
    assert.equal(
      cap(
        buildTenantReadiness({ ...FULLY_READY, domainReadiness: "pending_verification" }),
        "tenant_domains"
      )?.readiness,
      "incomplete"
    );
    assert.equal(
      cap(buildTenantReadiness({ ...FULLY_READY, domainReadiness: "degraded" }), "tenant_domains")
        ?.readiness,
      "degraded"
    );
    // optional capability → never drags the overall status down.
    assert.equal(
      buildTenantReadiness({ ...FULLY_READY, domainReadiness: "degraded" }).overall,
      "ready"
    );
  });

  it("never fakes readiness: deferred capabilities are always 'deferred'", () => {
    for (const signals of [
      FULLY_READY,
      {
        authCredential: "missing_credential" as const,
        activeAdminCount: 0,
        idpCount: null,
        emailSender: "missing_sender" as const,
        domainReadiness: "no_domains" as const,
      },
    ]) {
      const r = buildTenantReadiness(signals);
      // login simulation + claim/group-role mapping have no live check, so their
      // readiness must stay `deferred` regardless of signals (never faked).
      for (const key of [
        "storage",
        "oidc_login_simulation",
        "oidc_claim_mapping",
        "oidc_group_role_mapping",
      ]) {
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
