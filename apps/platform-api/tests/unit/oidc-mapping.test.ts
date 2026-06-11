import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import type { IdentityProvider, IdentityProviderMapper } from "@platform/authorisation-runtime";
import {
  applyIdpMapping,
  fromKeycloakMappers,
  readIdpMapping,
  toKeycloakMappers,
  type IdpMapperPort,
} from "../../src/usecases/idp-mapping.ts";

const ALIAS = "acme-oidc";
const IDP: IdentityProvider = {
  alias: ALIAS,
  displayName: "Acme",
  providerId: "oidc",
  enabled: true,
  config: { clientId: "c", clientSecret: "**********", issuer: "https://idp.example.com" },
};

const VALID_CONFIG = {
  claimMappings: [{ upstreamClaim: "department", userAttribute: "department" }],
  roleMappings: [{ upstreamClaim: "groups", claimValue: "admins", realmRole: "tenant-admin" }],
};

/** In-memory mapper port that records the order of side effects in `log`. */
function fakeMapperPort(opts: {
  idp?: IdentityProvider | null;
  initial?: IdentityProviderMapper[];
  log: string[];
  failOn?: "upsert" | "list" | "get";
}): IdpMapperPort {
  let store = [...(opts.initial ?? [])];
  let nextId = 100;
  return {
    async getIdentityProvider() {
      if (opts.failOn === "get") throw new Error("get failed: 502");
      return opts.idp === undefined ? IDP : opts.idp;
    },
    async listIdentityProviderMappers() {
      if (opts.failOn === "list") throw new Error("list failed: 403");
      return [...store];
    },
    async upsertIdentityProviderMapper(_alias, mapper) {
      if (opts.failOn === "upsert") throw new Error("upsert failed: 502");
      opts.log.push(`upsert:${mapper.name}`);
      const idx = store.findIndex((m) => m.name === mapper.name);
      const withId = mapper.id ? mapper : { ...mapper, id: String(nextId++) };
      if (idx >= 0) store[idx] = withId;
      else store.push(withId);
    },
    async deleteIdentityProviderMapper(_alias, mapperId) {
      opts.log.push(`delete:${mapperId}`);
      store = store.filter((m) => m.id !== mapperId);
    },
  };
}

function collectingAudit(log: string[]): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      async emit(e) {
        log.push("audit");
        events.push(e);
      },
      async query() {
        return [];
      },
    } as AuditEventPort,
  };
}

describe("idp-mapping — pure converters", () => {
  it("round-trips config → Keycloak mappers → config", () => {
    const mappers = toKeycloakMappers(ALIAS, VALID_CONFIG);
    assert.equal(mappers.length, 2);
    assert.ok(mappers.every((m) => m.name.startsWith("oidc-ent:")));
    const claim = mappers.find(
      (m) => m.identityProviderMapper === "oidc-user-attribute-idp-mapper"
    )!;
    assert.equal(claim.config["claim"], "department");
    assert.equal(claim.config["user.attribute"], "department");
    const role = mappers.find((m) => m.identityProviderMapper === "oidc-role-idp-mapper")!;
    assert.equal(role.config["role"], "tenant-admin");
    assert.deepEqual(fromKeycloakMappers(mappers), VALID_CONFIG);
  });

  it("ignores non-managed mappers when projecting back", () => {
    const foreign: IdentityProviderMapper = {
      name: "upstream-email_verified",
      identityProviderAlias: ALIAS,
      identityProviderMapper: "oidc-user-attribute-idp-mapper",
      config: { claim: "email_verified", "user.attribute": "emailVerified" },
    };
    const out = fromKeycloakMappers([foreign, ...toKeycloakMappers(ALIAS, VALID_CONFIG)]);
    assert.deepEqual(out, VALID_CONFIG);
  });

  it("drops a role mapper whose role is not an allowlisted tenant role", () => {
    const rogue: IdentityProviderMapper = {
      name: "oidc-ent:role:super-admin:x",
      identityProviderAlias: ALIAS,
      identityProviderMapper: "oidc-role-idp-mapper",
      config: { claim: "groups", "claim.value": "x", role: "super-admin" },
    };
    assert.deepEqual(fromKeycloakMappers([rogue]), { claimMappings: [], roleMappings: [] });
  });
});

describe("readIdpMapping", () => {
  it("returns not_found for an unknown alias", async () => {
    const log: string[] = [];
    const r = await readIdpMapping(ALIAS, { mapperPort: fakeMapperPort({ idp: null, log }) });
    assert.equal(r.kind, "not_found");
  });

  it("returns the projected managed mapping", async () => {
    const log: string[] = [];
    const r = await readIdpMapping(ALIAS, {
      mapperPort: fakeMapperPort({ initial: toKeycloakMappers(ALIAS, VALID_CONFIG), log }),
    });
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.deepEqual(r.config, VALID_CONFIG);
  });
});

describe("applyIdpMapping", () => {
  const baseInput = {
    alias: ALIAS,
    organisationId: "org-1",
    actorId: "user-1",
    actorRoles: ["tenant-admin"],
  };

  it("is audit-first: the audit event precedes any Keycloak write", async () => {
    const log: string[] = [];
    const audit = collectingAudit(log);
    const r = await applyIdpMapping(
      { ...baseInput, rawBody: VALID_CONFIG },
      { mapperPort: fakeMapperPort({ log }), audit: audit.port }
    );
    assert.equal(r.kind, "ok");
    assert.equal(log[0], "audit", "audit must be emitted before any mapper write");
    assert.equal(audit.events[0]!.action, "auth_settings.idp.mapping.changed");
    const meta = JSON.stringify(audit.events[0]!.metadata);
    assert.ok(meta.includes("claimMappingCount"));
    assert.ok(!meta.toLowerCase().includes("secret"));
  });

  it("reconciles: deletes managed mappers no longer desired, keeps foreign ones", async () => {
    const log: string[] = [];
    const foreign: IdentityProviderMapper = {
      id: "9",
      name: "upstream-email_verified",
      identityProviderAlias: ALIAS,
      identityProviderMapper: "oidc-user-attribute-idp-mapper",
      config: { claim: "email_verified", "user.attribute": "emailVerified" },
    };
    const stale = toKeycloakMappers(ALIAS, {
      claimMappings: [{ upstreamClaim: "old", userAttribute: "old" }],
      roleMappings: [],
    }).map((m, i) => ({ ...m, id: String(50 + i) }));
    const port = fakeMapperPort({ initial: [foreign, ...stale], log });
    const audit = collectingAudit(log);
    const r = await applyIdpMapping(
      { ...baseInput, rawBody: VALID_CONFIG },
      { mapperPort: port, audit: audit.port }
    );
    assert.equal(r.kind, "ok");
    // the stale managed claim mapper (id 50) is deleted; the foreign one (id 9) is not.
    assert.ok(log.includes("delete:50"));
    assert.ok(!log.includes("delete:9"));
  });

  it("rejects an empty/dangerous claim name", async () => {
    const log: string[] = [];
    const audit = collectingAudit(log);
    const r = await applyIdpMapping(
      {
        ...baseInput,
        rawBody: { claimMappings: [{ upstreamClaim: "", userAttribute: "x" }], roleMappings: [] },
      },
      { mapperPort: fakeMapperPort({ log }), audit: audit.port }
    );
    assert.equal(r.kind, "invalid_body");
    assert.equal(audit.events.length, 0);
  });

  it("rejects a role outside the tenant-role allowlist", async () => {
    const log: string[] = [];
    const audit = collectingAudit(log);
    const r = await applyIdpMapping(
      {
        ...baseInput,
        rawBody: {
          claimMappings: [],
          roleMappings: [{ upstreamClaim: "g", claimValue: "x", realmRole: "super-admin" }],
        },
      },
      { mapperPort: fakeMapperPort({ log }), audit: audit.port }
    );
    assert.equal(r.kind, "invalid_body");
  });

  it("returns not_found when the IdP does not exist", async () => {
    const log: string[] = [];
    const audit = collectingAudit(log);
    const r = await applyIdpMapping(
      { ...baseInput, rawBody: VALID_CONFIG },
      { mapperPort: fakeMapperPort({ idp: null, log }), audit: audit.port }
    );
    assert.equal(r.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("classifies a realm failure (no bare 500)", async () => {
    const log: string[] = [];
    const audit = collectingAudit(log);
    const r = await applyIdpMapping(
      { ...baseInput, rawBody: VALID_CONFIG },
      { mapperPort: fakeMapperPort({ log, failOn: "upsert" }), audit: audit.port }
    );
    assert.equal(r.kind, "realm_unreachable"); // upsert error message carries "502" → realm_unreachable
  });
});
