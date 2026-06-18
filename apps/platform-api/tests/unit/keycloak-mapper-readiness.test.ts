/**
 * Unit tests for the Keycloak mapper readiness check (ADR-ACT-0181).
 *
 * Tests are pure — no real Keycloak connection required.
 *
 * Coverage:
 *   1. hasUserinfoRealmRolesMapper predicate — present / missing / wrong config
 *   2. getReadiness with injected mapper: present → keycloak_mapper: ok
 *   3. getReadiness with injected mapper: missing + NODE_ENV=production → failed
 *   4. getReadiness with injected mapper: missing + NODE_ENV=development → unknown
 *   5. getReadiness with injected mapper: unavailable → unknown (not silent ok)
 *   6. Fixture mode (LOCAL_FIXTURE_SESSION set) always returns ok regardless
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  hasUserinfoRealmRolesMapper,
  KeycloakRealmAdminAdapter,
} from "@platform/adapters-keycloak";
import type { ReadinessResponse, DependencyStatus } from "@platform/api-runtime";
import { getReadiness, _resetMapperMemo, type MapperCheckConfig } from "../../src/server/health.ts";

// ---------------------------------------------------------------------------
// hasUserinfoRealmRolesMapper — pure predicate
// ---------------------------------------------------------------------------

describe("hasUserinfoRealmRolesMapper", () => {
  it("returns true when a correctly configured mapper is present", () => {
    const mappers = [
      {
        name: "realm-roles-userinfo",
        protocol: "openid-connect",
        protocolMapper: "oidc-usermodel-realm-role-mapper",
        config: {
          "claim.name": "realm_access.roles",
          multivalued: "true",
          "userinfo.token.claim": "true",
          "id.token.claim": "false",
          "access.token.claim": "false",
        },
      },
    ];
    assert.ok(hasUserinfoRealmRolesMapper(mappers));
  });

  it("returns false when mapper list is empty", () => {
    assert.ok(!hasUserinfoRealmRolesMapper([]));
  });

  it("returns false when protocolMapper type is wrong", () => {
    const mappers = [
      {
        protocolMapper: "oidc-hardcoded-role-mapper",
        config: {
          "claim.name": "realm_access.roles",
          "userinfo.token.claim": "true",
        },
      },
    ];
    assert.ok(!hasUserinfoRealmRolesMapper(mappers));
  });

  it("returns false when claim.name is wrong", () => {
    const mappers = [
      {
        protocolMapper: "oidc-usermodel-realm-role-mapper",
        config: {
          "claim.name": "roles",
          "userinfo.token.claim": "true",
        },
      },
    ];
    assert.ok(!hasUserinfoRealmRolesMapper(mappers));
  });

  it("returns false when userinfo.token.claim is not true", () => {
    const mappers = [
      {
        protocolMapper: "oidc-usermodel-realm-role-mapper",
        config: {
          "claim.name": "realm_access.roles",
          "userinfo.token.claim": "false",
        },
      },
    ];
    assert.ok(!hasUserinfoRealmRolesMapper(mappers));
  });

  it("returns true even if name differs — matching on functional config only", () => {
    const mappers = [
      {
        name: "bff_realm_roles_userinfo", // Terraform resource name vs Keycloak name
        protocolMapper: "oidc-usermodel-realm-role-mapper",
        config: {
          "claim.name": "realm_access.roles",
          "userinfo.token.claim": "true",
        },
      },
    ];
    assert.ok(hasUserinfoRealmRolesMapper(mappers));
  });
});

// ---------------------------------------------------------------------------
// getReadiness — keycloak_mapper dependency
//
// Stubs KeycloakRealmAdminAdapter.checkUserinfoRealmRolesMapper on the
// prototype so no real Keycloak connection is made.
// ---------------------------------------------------------------------------

let _stubResult: "present" | "missing" | "unavailable" | null = null;

const originalCheck = KeycloakRealmAdminAdapter.prototype.checkUserinfoRealmRolesMapper;

before(() => {
  KeycloakRealmAdminAdapter.prototype.checkUserinfoRealmRolesMapper = async function (
    _clientId: string
  ) {
    if (_stubResult !== null) return _stubResult;
    return originalCheck.call(this, _clientId);
  };
});

after(() => {
  KeycloakRealmAdminAdapter.prototype.checkUserinfoRealmRolesMapper = originalCheck;
  _stubResult = null;
});

// Minimal stub — adminConfig fields don't matter since we mock the method
const STUB_ADMIN_CONFIG: MapperCheckConfig = {
  adminConfig: {
    url: "http://localhost:8090/kc",
    realm: "platform",
    adminClientId: "platform-provisioner",
    adminClientSecret: "secret",
  },
  clientId: "platform-api",
};

// Use an unreachable URL so Postgres doesn't hang — the check returns "failed"
// for DB but "ok"/"unknown"/"failed" for mapper, which is what we're testing.
const NO_POSTGRES_URL = "postgresql://localhost:1/noop";

function mapperStatus(result: ReadinessResponse): DependencyStatus {
  return result.dependencies["keycloak_mapper"] as DependencyStatus;
}

describe("getReadiness — keycloak_mapper dependency", () => {
  before(() => {
    _resetMapperMemo();
    delete process.env["LOCAL_FIXTURE_SESSION"];
  });

  after(() => {
    _resetMapperMemo();
    delete process.env["LOCAL_FIXTURE_SESSION"];
    _stubResult = null;
  });

  it("mapper present → keycloak_mapper: ok", async () => {
    _stubResult = "present";
    _resetMapperMemo();
    const result = await getReadiness({
      postgresUrl: NO_POSTGRES_URL,
      mapperConfig: STUB_ADMIN_CONFIG,
    });
    assert.equal(mapperStatus(result), "ok");
  });

  it("mapper missing in production → keycloak_mapper: failed, status not-ready", async () => {
    _stubResult = "missing";
    _resetMapperMemo();
    const savedEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const result = await getReadiness({
        postgresUrl: NO_POSTGRES_URL,
        mapperConfig: STUB_ADMIN_CONFIG,
      });
      assert.equal(mapperStatus(result), "failed");
      assert.equal(result.status, "not-ready");
    } finally {
      process.env["NODE_ENV"] = savedEnv;
    }
  });

  it("mapper missing in development → keycloak_mapper: unknown (warning only)", async () => {
    _stubResult = "missing";
    _resetMapperMemo();
    const savedEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      const result = await getReadiness({
        postgresUrl: NO_POSTGRES_URL,
        mapperConfig: STUB_ADMIN_CONFIG,
      });
      assert.equal(mapperStatus(result), "unknown");
    } finally {
      process.env["NODE_ENV"] = savedEnv;
    }
  });

  it("Keycloak unavailable → keycloak_mapper: unknown (not silent success)", async () => {
    _stubResult = "unavailable";
    _resetMapperMemo();
    const result = await getReadiness({
      postgresUrl: NO_POSTGRES_URL,
      mapperConfig: STUB_ADMIN_CONFIG,
    });
    const status = mapperStatus(result);
    // Must NOT silently return "ok" when Keycloak admin is unreachable
    assert.notEqual(status, "ok");
    assert.equal(status, "unknown");
  });

  it("fixture mode (LOCAL_FIXTURE_SESSION set) → keycloak_mapper: ok regardless of mapper state", async () => {
    _stubResult = "missing";
    _resetMapperMemo();
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";
    const savedEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const result = await getReadiness({
        postgresUrl: NO_POSTGRES_URL,
        mapperConfig: STUB_ADMIN_CONFIG,
      });
      assert.equal(mapperStatus(result), "ok");
    } finally {
      delete process.env["LOCAL_FIXTURE_SESSION"];
      process.env["NODE_ENV"] = savedEnv;
    }
  });

  it("null mapperConfig (no provisioner env vars) → keycloak_mapper: unknown", async () => {
    _stubResult = null;
    _resetMapperMemo();
    const result = await getReadiness({
      postgresUrl: NO_POSTGRES_URL,
      mapperConfig: null,
    });
    assert.equal(mapperStatus(result), "unknown");
  });
});
