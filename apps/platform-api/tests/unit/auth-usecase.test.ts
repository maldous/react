import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSessionFromIdentity,
  readSession,
  destroySession,
  type AuthUseCaseDeps,
} from "../../src/usecases/auth.ts";
import type { KeycloakIdentityResult } from "@platform/adapters-keycloak";
import type { IdentityRepository } from "../../src/ports/identity-repository.ts";
import type { SessionStore, SessionRecord } from "@platform/session-runtime";

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

const FIXTURE_USER = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "admin@fixture.local",
  displayName: "Fixture Admin",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const FIXTURE_EI = {
  id: "ei-1",
  userId: FIXTURE_USER.id,
  provider: "keycloak" as const,
  providerSubject: "kc-sub-1",
  createdAt: new Date("2024-01-01"),
};

const FIXTURE_MEMBERSHIP = {
  id: "m-1",
  userId: FIXTURE_USER.id,
  organisationId: "00000000-0000-0000-0000-000000000001",
  role: "tenant-admin" as const,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const KEYCLOAK_IDENTITY: KeycloakIdentityResult = {
  providerSubject: "kc-sub-1",
  provider: "keycloak",
  email: "admin@fixture.local",
  displayName: "Fixture Admin",
  realmRoles: ["tenant-admin"],
};

function makeFakeIdentityRepo(overrides: Partial<IdentityRepository> = {}): IdentityRepository {
  return {
    findExternalIdentity: async () => ({ user: FIXTURE_USER, externalIdentity: FIXTURE_EI }),
    createUserAndExternalIdentity: async () => ({
      user: FIXTURE_USER,
      externalIdentity: FIXTURE_EI,
    }),
    findUserByEmail: async () => null,
    linkExternalIdentity: async () => FIXTURE_EI,
    findMembershipByUser: async () => FIXTURE_MEMBERSHIP,
    consumePendingInvitationsForUser: async () => [],
    ...overrides,
  };
}

function makeFakeSessionStore(): SessionStore & { _store: Map<string, SessionRecord> } {
  const _store = new Map<string, SessionRecord>();
  return {
    _store,
    async create(cmd) {
      const id = `session-${Math.random().toString(36).slice(2)}`;
      _store.set(id, {
        sessionId: id,
        ...cmd,
        expiresAt: new Date(Date.now() + cmd.ttlSeconds * 1000),
        createdAt: new Date(),
      });
      return id;
    },
    async find(id) {
      return _store.get(id) ?? null;
    },
    async refresh() {},
    async destroy(id) {
      _store.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// resolveSessionFromIdentity
// ---------------------------------------------------------------------------

describe("resolveSessionFromIdentity", () => {
  it("returns a session with correct fields for known identity", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo(),
      sessions,
    };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.equal(result.userId, FIXTURE_USER.id);
    assert.equal(result.tenantId, FIXTURE_MEMBERSHIP.organisationId);
    assert.equal(result.organisationId, FIXTURE_MEMBERSHIP.organisationId);
    assert.deepEqual(result.roles, ["tenant-admin"]);
    assert.ok(result.permissions.includes("organisation.read"));
    assert.ok(result.permissions.includes("organisation.update"));
    assert.equal(result.displayName, FIXTURE_USER.displayName);
    assert.ok(typeof result.sessionId === "string");
  });

  it("creates user and identity for first-time login", async () => {
    let createCalled = false;
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({
        findExternalIdentity: async () => null,
        createUserAndExternalIdentity: async () => {
          createCalled = true;
          return { user: FIXTURE_USER, externalIdentity: FIXTURE_EI };
        },
      }),
      sessions,
    };
    await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(createCalled, "createUserAndExternalIdentity must be called for first-time login");
  });

  it("re-links a rotated IdP subject to the existing account (ADR-ACT-0282)", async () => {
    // Unknown (provider, subject) but the email already has an account — e.g. after a
    // Keycloak realm rebuild. Must re-link (NOT create / conflict).
    let linked = false;
    let createCalled = false;
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({
        findExternalIdentity: async () => null,
        findUserByEmail: async () => FIXTURE_USER,
        linkExternalIdentity: async () => {
          linked = true;
          return FIXTURE_EI;
        },
        createUserAndExternalIdentity: async () => {
          createCalled = true;
          return { user: FIXTURE_USER, externalIdentity: FIXTURE_EI };
        },
      }),
      sessions,
    };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(linked, "linkExternalIdentity must be called when the email already exists");
    assert.ok(!createCalled, "must NOT create a new user when re-linking");
    assert.equal(result.userId, FIXTURE_USER.id);
  });

  it("handles no-membership: sets empty tenantId and no permissions", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({ findMembershipByUser: async () => null }),
      sessions,
    };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.equal(result.tenantId, "");
    assert.equal(result.organisationId, "");
    assert.deepEqual(result.roles, []);
    assert.deepEqual(result.permissions, []);
  });

  // All five ADR-0021 tenant-scoped roles sourced from DB membership
  for (const role of ["tenant-admin", "manager", "member", "viewer"] as const) {
    it(`membership role "${role}" is reflected in session roles and permissions`, async () => {
      const sessions = makeFakeSessionStore();
      const deps: AuthUseCaseDeps = {
        identities: makeFakeIdentityRepo({
          findMembershipByUser: async () => ({ ...FIXTURE_MEMBERSHIP, role }),
        }),
        sessions,
      };
      const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
      assert.deepEqual(result.roles, [role]);
      assert.ok(
        result.permissions.includes("organisation.read"),
        `${role} must have organisation.read`
      );
      assert.equal(result.tenantId, FIXTURE_MEMBERSHIP.organisationId);
    });
  }

  it("tenant-admin membership has org write and tenant.admin.access permissions", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = { identities: makeFakeIdentityRepo(), sessions };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(result.permissions.includes("organisation.update"));
    assert.ok(result.permissions.includes("tenant.admin.access"));
    // tenant-admin uses tenant.members.* (the enforced permissions).
    // Legacy member.invite was removed from the tenant-admin bundle in ADR-ACT-0143 hardening.
    assert.ok(result.permissions.includes("tenant.members.invite"));
    assert.ok(result.permissions.includes("tenant.members.delete"));
  });

  it("viewer membership does not have write permissions", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({
        findMembershipByUser: async () => ({ ...FIXTURE_MEMBERSHIP, role: "viewer" as const }),
      }),
      sessions,
    };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(!result.permissions.includes("organisation.update"));
    assert.ok(!result.permissions.includes("tenant.admin.access"));
    assert.ok(!result.permissions.includes("platform.admin.access"));
    assert.ok(!result.permissions.includes("member.invite"));
  });

  it("manager membership can invite members but cannot update org settings", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({
        findMembershipByUser: async () => ({ ...FIXTURE_MEMBERSHIP, role: "manager" as const }),
      }),
      sessions,
    };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(result.permissions.includes("member.invite"));
    assert.ok(!result.permissions.includes("organisation.update"));
    assert.ok(!result.permissions.includes("tenant.admin.access"));
    assert.ok(!result.permissions.includes("platform.admin.access"));
  });

  it("system-admin realm role grants session role without DB membership", async () => {
    let membershipCalled = false;
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({
        findMembershipByUser: async () => {
          membershipCalled = true;
          return null;
        },
      }),
      sessions,
    };
    const sysadminIdentity: KeycloakIdentityResult = {
      ...KEYCLOAK_IDENTITY,
      realmRoles: ["system-admin"],
    };
    const result = await resolveSessionFromIdentity(sysadminIdentity, deps);
    assert.deepEqual(result.roles, ["system-admin"]);
    assert.ok(
      result.permissions.includes("platform.admin.access"),
      "system-admin must have platform.admin.access"
    );
    assert.ok(
      !result.permissions.includes("tenant.admin.access"),
      "system-admin must NOT have tenant.admin.access"
    );
    assert.ok(result.permissions.includes("organisation.read"));
    assert.equal(result.tenantId, "");
    assert.equal(result.organisationId, "");
    assert.equal(membershipCalled, false, "DB membership lookup must be skipped for system-admin");
  });

  it("system-admin realm role wins over existing DB membership", async () => {
    // Even if the user somehow has a membership, the system-admin realm role takes precedence.
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo(), // default: FIXTURE_MEMBERSHIP (tenant-admin)
      sessions,
    };
    const sysadminIdentity: KeycloakIdentityResult = {
      ...KEYCLOAK_IDENTITY,
      realmRoles: ["system-admin"],
    };
    const result = await resolveSessionFromIdentity(sysadminIdentity, deps);
    assert.deepEqual(result.roles, ["system-admin"]);
    assert.equal(result.tenantId, "");
  });

  it("non-system-admin Keycloak realm roles do not pollute session roles", async () => {
    // Keycloak adds built-in roles like offline_access and uma_authorization.
    // These must not appear in the platform session.
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({ findMembershipByUser: async () => null }),
      sessions,
    };
    const identity: KeycloakIdentityResult = {
      ...KEYCLOAK_IDENTITY,
      realmRoles: ["offline_access", "uma_authorization", "default-roles-platform"],
    };
    const result = await resolveSessionFromIdentity(identity, deps);
    assert.deepEqual(result.roles, []);
    assert.deepEqual(result.permissions, []);
  });

  it("stores no raw tokens in the session", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo(),
      sessions,
    };
    const { sessionId } = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    const record = sessions._store.get(sessionId);
    assert.ok(record !== undefined);
    const keys = Object.keys(record);
    assert.ok(!keys.includes("accessToken"));
    assert.ok(!keys.includes("refreshToken"));
  });

  it("permissions are resolved from role via resolvePermissions", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = {
      identities: makeFakeIdentityRepo({
        findMembershipByUser: async () => ({ ...FIXTURE_MEMBERSHIP, role: "viewer" as const }),
      }),
      sessions,
    };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(result.permissions.includes("organisation.read"));
    assert.ok(!result.permissions.includes("organisation.update"));
  });
});

// ---------------------------------------------------------------------------
// readSession
// ---------------------------------------------------------------------------

describe("readSession", () => {
  it("returns session resolution for valid sessionId", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = { identities: makeFakeIdentityRepo(), sessions };
    const { sessionId } = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    const result = await readSession(sessionId, { sessions });
    assert.ok(result !== null);
    assert.equal(result.userId, FIXTURE_USER.id);
  });

  it("returns null for unknown sessionId", async () => {
    const sessions = makeFakeSessionStore();
    const result = await readSession("nonexistent", { sessions });
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// destroySession
// ---------------------------------------------------------------------------

describe("destroySession", () => {
  it("removes session so readSession returns null", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = { identities: makeFakeIdentityRepo(), sessions };
    const { sessionId } = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    await destroySession(sessionId, { sessions });
    const result = await readSession(sessionId, { sessions });
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// Token storage (ADR-ACT-0153)
// ---------------------------------------------------------------------------

describe("resolveSessionFromIdentity — token storage", () => {
  it("stores encrypted token fields when tokens are provided", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = { identities: makeFakeIdentityRepo(), sessions };
    await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps, 1800, {
      accessToken: "at-abc123",
      refreshToken: "rt-xyz789",
      expiresIn: 900,
    });
    const created = sessions._store.values().next().value as SessionRecord;
    assert.ok(created.accessTokenEnc, "must store encrypted access token");
    assert.ok(created.refreshTokenEnc, "must store encrypted refresh token");
    assert.ok(created.accessTokenExpiresAt instanceof Date);
    // Tokens must be stored in enc: or unenc: format — never raw plaintext without a prefix
    assert.ok(
      created.accessTokenEnc.startsWith("enc:") || created.accessTokenEnc.startsWith("unenc:"),
      "token must use encryption format"
    );
  });

  it("does not store token fields when no tokens provided (fixture sessions)", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = { identities: makeFakeIdentityRepo(), sessions };
    await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps, 1800);
    const created = sessions._store.values().next().value as SessionRecord;
    assert.equal(created.accessTokenEnc, undefined);
    assert.equal(created.refreshTokenEnc, undefined);
  });
});
