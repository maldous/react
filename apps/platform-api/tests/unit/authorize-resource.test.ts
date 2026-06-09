/**
 * Unit tests for authorizeResourceAccess (ADR-ACT-0199).
 * The per-operation UMA gate used by /api/graphql. Verifies it mirrors the REST
 * route gate: UMA-first → static fallback → fail-closed, with injected deps so
 * no Keycloak/Redis is required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SessionActor } from "@platform/contracts-auth";
import type { AccessDecision, AuthorisationPort } from "@platform/authorisation-runtime";
import { authorizeResourceAccess } from "../../src/server/authorize-resource.ts";

const GUARD = {
  resource: "organisation:profile",
  umaScope: "read",
  requiredPermission: "organisation.read",
};

function actor(overrides: Partial<SessionActor> = {}): SessionActor {
  return {
    userId: "u-1",
    tenantId: "t-1",
    organisationId: "o-1",
    roles: ["viewer"],
    permissions: [],
    displayName: "User One",
    ...overrides,
  } as SessionActor;
}

function port(decision: AccessDecision): AuthorisationPort {
  return { checkAccess: async () => decision };
}

const deps = (decision: AccessDecision, token: string | null = "raw-token") => ({
  authorisationPort: () => port(decision),
  resolveToken: async () => token,
  sessionStore: {} as never,
});

describe("authorizeResourceAccess — static fallback (no token)", () => {
  it("allows when the actor holds the required permission", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ permissions: ["organisation.read"] }),
      sessionId: null,
      fqdnTenant: null,
      guard: GUARD,
    });
    assert.deepEqual(out, { ok: true });
  });

  it("denies (403) when the actor lacks the required permission", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ permissions: [] }),
      sessionId: null,
      fqdnTenant: null,
      guard: GUARD,
    });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.status, 403);
  });
});

describe("authorizeResourceAccess — UMA path (token present)", () => {
  it("allows when UMA grants", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ accessTokenEnc: "enc", permissions: [] }),
      sessionId: "s-1",
      fqdnTenant: null,
      guard: GUARD,
      deps: deps({ granted: true, rpt: "rpt" }),
    });
    assert.deepEqual(out, { ok: true });
  });

  it("denies (403) when UMA returns policy_denied — even without static fallback", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ accessTokenEnc: "enc", permissions: ["organisation.read"] }),
      sessionId: "s-1",
      fqdnTenant: null,
      guard: GUARD,
      deps: deps({ granted: false, reason: "policy_denied" }),
    });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.status, 403);
  });

  it("returns 401 step-up when UMA reports insufficient_auth_level", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ accessTokenEnc: "enc", permissions: ["organisation.read"] }),
      sessionId: "s-1",
      fqdnTenant: null,
      guard: GUARD,
      deps: deps({ granted: false, reason: "insufficient_auth_level" }),
    });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.code, "stepUpRequired");
  });

  it("falls back to static check when Keycloak is unavailable (allow)", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ accessTokenEnc: "enc", permissions: ["organisation.read"] }),
      sessionId: "s-1",
      fqdnTenant: null,
      guard: GUARD,
      deps: deps({ granted: false, reason: "keycloak_unavailable" }),
    });
    assert.deepEqual(out, { ok: true });
  });

  it("falls back to static check when Keycloak is unavailable (deny without permission)", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ accessTokenEnc: "enc", permissions: [] }),
      sessionId: "s-1",
      fqdnTenant: null,
      guard: GUARD,
      deps: deps({ granted: false, reason: "keycloak_unavailable" }),
    });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.status, 403);
  });

  it("returns 401 when a token is expected but cannot be resolved", async () => {
    const out = await authorizeResourceAccess({
      actor: actor({ accessTokenEnc: "enc", permissions: ["organisation.read"] }),
      sessionId: "s-1",
      fqdnTenant: null,
      guard: GUARD,
      deps: deps({ granted: true, rpt: "rpt" }, null),
    });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.code, "authenticationRequired");
  });
});
