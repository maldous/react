/**
 * Unit tests for ADR-0043 / ADR-ACT-0211 IdP management mappers.
 * Pure — no HTTP/Keycloak. Focus: redaction (no secret leaks), secret-preserving
 * update merge, and audit metadata that never carries the secret value.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IdentityProvider } from "@platform/authorisation-runtime";
import {
  toIdpSummary,
  buildCreateRepresentation,
  applyUpdate,
  buildIdpCreateAuditMetadata,
  buildIdpUpdateAuditMetadata,
  buildIdpDeleteAuditMetadata,
} from "../../src/usecases/idp-management.ts";
import { CreateIdpRequestSchema } from "@platform/contracts-admin";

const VALID_OIDC = {
  alias: "acme-oidc",
  displayName: "Acme",
  providerId: "oidc",
  clientId: "c",
  clientSecret: "s3cr3t",
  authorizationUrl: "https://idp.acme.test/auth",
  tokenUrl: "https://idp.acme.test/token",
};

// What Keycloak actually returns on read: clientSecret masked, plus many extra fields.
const RAW: IdentityProvider = {
  alias: "acme-oidc",
  displayName: "Acme SSO",
  providerId: "oidc",
  enabled: true,
  trustEmail: true,
  config: {
    clientId: "acme-client",
    clientSecret: "**********",
    authorizationUrl: "https://idp.acme.test/auth",
    tokenUrl: "https://idp.acme.test/token",
    defaultScope: "openid email",
  },
} as IdentityProvider;

describe("toIdpSummary — redaction", () => {
  it("maps explicit fields and never exposes the secret value", () => {
    const summary = toIdpSummary(RAW);
    assert.deepEqual(summary, {
      alias: "acme-oidc",
      displayName: "Acme SSO",
      providerId: "oidc",
      enabled: true,
      trustEmail: true,
      hasClientSecret: true,
      clientId: "acme-client",
      scopes: "openid email",
    });
    // The serialised summary must not contain the raw config or any secret marker.
    const serialised = JSON.stringify(summary);
    assert.ok(!serialised.includes("clientSecret"));
    assert.ok(!serialised.includes("**********"));
    assert.ok(!serialised.includes("authorizationUrl"));
  });

  it("reports hasClientSecret=false when no secret is configured", () => {
    const summary = toIdpSummary({
      alias: "no-secret",
      displayName: "x",
      providerId: "oidc",
      enabled: false,
      config: { clientId: "c" },
    } as IdentityProvider);
    assert.equal(summary.hasClientSecret, false);
    assert.equal(summary.scopes, null);
  });
});

describe("buildCreateRepresentation", () => {
  it("places clientId/clientSecret/urls/scopes into config", () => {
    const rep = buildCreateRepresentation({
      alias: "acme-oidc",
      displayName: "Acme",
      providerId: "oidc",
      clientId: "c",
      clientSecret: "s3cr3t",
      authorizationUrl: "https://idp.acme.test/auth",
      tokenUrl: "https://idp.acme.test/token",
      scopes: "openid email",
      trustEmail: true,
      enabled: true,
    });
    assert.equal(rep.config["clientSecret"], "s3cr3t");
    assert.equal(rep.config["defaultScope"], "openid email");
    assert.equal(rep.trustEmail, true);
  });
});

describe("applyUpdate — secret preservation", () => {
  it("keeps the existing (masked) secret when clientSecret is absent", () => {
    const merged = applyUpdate(RAW, { displayName: "Renamed" });
    assert.equal(merged.displayName, "Renamed");
    assert.equal(merged.config["clientSecret"], "**********"); // mask re-sent → preserved
    assert.equal(merged.config["clientId"], "acme-client");
  });

  it("keeps the existing secret when clientSecret is an empty string", () => {
    const merged = applyUpdate(RAW, { clientSecret: "", scopes: "openid" });
    assert.equal(merged.config["clientSecret"], "**********");
    assert.equal(merged.config["defaultScope"], "openid");
  });

  it("overwrites the secret when a non-empty clientSecret is supplied", () => {
    const merged = applyUpdate(RAW, { clientSecret: "rotated-secret" });
    assert.equal(merged.config["clientSecret"], "rotated-secret");
  });

  it("toggles enabled without touching the secret", () => {
    const merged = applyUpdate(RAW, { enabled: false });
    assert.equal(merged.enabled, false);
    assert.equal(merged.config["clientSecret"], "**********");
  });
});

describe("audit metadata — no secret leakage", () => {
  it("create metadata records clientId + hasClientSecret but not the secret", () => {
    const meta = buildIdpCreateAuditMetadata({
      alias: "acme-oidc",
      displayName: "Acme",
      providerId: "oidc",
      clientId: "c",
      clientSecret: "super-secret-value",
      trustEmail: false,
      enabled: true,
    });
    const serialised = JSON.stringify(meta);
    assert.ok(serialised.includes("acme-oidc"));
    assert.ok(serialised.includes('"hasClientSecret":true'));
    assert.ok(!serialised.includes("super-secret-value"));
    assert.ok(!serialised.includes('clientSecret":"')); // no secret value key
  });

  it("update metadata lists changed field NAMES, never the secret value", () => {
    const meta = buildIdpUpdateAuditMetadata("acme-oidc", {
      displayName: "Renamed",
      clientSecret: "rotated-secret-value",
    });
    assert.deepEqual((meta as { changedFields: string[] }).changedFields, ["displayName"]);
    assert.equal((meta as { secretChanged: boolean }).secretChanged, true);
    assert.ok(!JSON.stringify(meta).includes("rotated-secret-value"));
  });

  it("delete metadata is just the alias + operation", () => {
    assert.deepEqual(buildIdpDeleteAuditMetadata("acme-oidc"), {
      operation: "delete",
      alias: "acme-oidc",
    });
  });
});

describe("CreateIdpRequestSchema — validation", () => {
  it("accepts a valid oidc request", () => {
    assert.equal(CreateIdpRequestSchema.safeParse(VALID_OIDC).success, true);
  });

  it("rejects a reserved alias", () => {
    const r = CreateIdpRequestSchema.safeParse({ ...VALID_OIDC, alias: "platform" });
    assert.equal(r.success, false);
  });

  it("rejects an alias with illegal characters", () => {
    assert.equal(
      CreateIdpRequestSchema.safeParse({ ...VALID_OIDC, alias: "Bad Alias!" }).success,
      false
    );
  });

  it("rejects a non-allowlisted providerId (e.g. saml)", () => {
    assert.equal(
      CreateIdpRequestSchema.safeParse({ ...VALID_OIDC, providerId: "saml" }).success,
      false
    );
  });

  it("rejects an unsafe URL scheme", () => {
    assert.equal(
      CreateIdpRequestSchema.safeParse({
        ...VALID_OIDC,
        authorizationUrl: "javascript:alert(1)",
      }).success,
      false
    );
  });

  it("rejects an oidc request missing the required URLs", () => {
    const { authorizationUrl: _a, tokenUrl: _t, ...noUrls } = VALID_OIDC;
    assert.equal(CreateIdpRequestSchema.safeParse(noUrls).success, false);
  });

  it("allows a social provider (google) without URLs", () => {
    const { authorizationUrl: _a, tokenUrl: _t, ...base } = VALID_OIDC;
    assert.equal(
      CreateIdpRequestSchema.safeParse({ ...base, alias: "goog", providerId: "google" }).success,
      true
    );
  });
});
