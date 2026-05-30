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
    findMembershipByUser: async () => FIXTURE_MEMBERSHIP,
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

  it("tenant-admin membership has org write and admin.access permissions", async () => {
    const sessions = makeFakeSessionStore();
    const deps: AuthUseCaseDeps = { identities: makeFakeIdentityRepo(), sessions };
    const result = await resolveSessionFromIdentity(KEYCLOAK_IDENTITY, deps);
    assert.ok(result.permissions.includes("organisation.update"));
    assert.ok(result.permissions.includes("admin.access"));
    assert.ok(result.permissions.includes("member.invite"));
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
    assert.ok(!result.permissions.includes("admin.access"));
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
    assert.ok(!result.permissions.includes("admin.access"));
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
    assert.ok(result.permissions.includes("admin.access"), "system-admin must have admin.access");
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
