/**
 * Unit tests for ADR-ACT-0232 — tenant domain lifecycle operations.
 * Fake ports (registry / audit / auth client / probe); no DB, no Keycloak.
 * Verifies ordering invariants:
 *   - audit precedes the external mutation (audit-first, ADR-ACT-0154)
 *   - the registry records 'active' ONLY after the Keycloak mutation succeeded
 *   - routing_local_active is recorded ONLY on a positive live probe
 *   - canonical is atomic-by-port and guard-protected
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuditEventPort } from "@platform/audit-events";
import type {
  TenantDomainRecord,
  TenantDomainRegistryPort,
} from "../../src/ports/tenant-domain-registry.ts";
import type { LocalRoutingProbePort } from "../../src/ports/domain-routing-probe.ts";
import {
  activateDomainAuthClient,
  deactivateDomainAuthClient,
  probeDomainLocalRouting,
  setCanonicalDomain,
  type AuthClientDomainPort,
} from "../../src/usecases/tenant-domain-lifecycle.ts";

const ACTOR = { actorId: "user-1", actorRoles: ["tenant-admin"] };

function record(over: Partial<TenantDomainRecord> = {}): TenantDomainRecord {
  return {
    organisationId: "org-1",
    domain: "app.acme.test",
    source: "custom",
    ownershipStatus: "verified",
    authClientStatus: "inactive",
    routingStatus: "routing_unknown",
    tlsStatus: "tls_unknown",
    canonical: false,
    redirectPolicy: "no_redirect",
    createdAt: new Date(),
    verifiedAt: new Date(),
    authClientActivatedAt: null,
    routingLocalProvenAt: null,
    routingPublicProvenAt: null,
    tlsLocalProvenAt: null,
    tlsPublicProvenAt: null,
    canonicalAt: null,
    disabledAt: null,
    ...over,
  };
}

function fakeDeps(initial: TenantDomainRecord | null) {
  const calls: string[] = [];
  let current = initial;
  const registry: TenantDomainRegistryPort = {
    listDomains: async () => (current ? [current] : []),
    getDomain: async () => current,
    ensurePending: async () => {
      calls.push("ensurePending");
      return { kind: "created" as const };
    },
    markOwnership: async () => {
      calls.push("markOwnership");
    },
    markAuthClientActive: async () => {
      calls.push("markAuthClientActive");
      if (current) {
        current = { ...current, authClientStatus: "active", authClientActivatedAt: new Date() };
      }
    },
    markAuthClientInactive: async () => {
      calls.push("markAuthClientInactive");
      if (current) {
        current = {
          ...current,
          authClientStatus: "inactive",
          authClientActivatedAt: null,
          canonical: false,
          canonicalAt: null,
          routingStatus: "routing_unknown",
          routingLocalProvenAt: null,
        };
      }
    },
    markRoutingLocalActive: async () => {
      calls.push("markRoutingLocalActive");
      if (current) {
        current = {
          ...current,
          routingStatus: "routing_local_active",
          routingLocalProvenAt: new Date(),
        };
      }
    },
    setCanonical: async () => {
      calls.push("setCanonical");
      if (current)
        current = {
          ...current,
          canonical: true,
          canonicalAt: new Date(),
          redirectPolicy: "redirect_slug_to_canonical",
        };
    },
    unsetCanonical: async () => {
      calls.push("unsetCanonical");
      if (current)
        current = {
          ...current,
          canonical: false,
          canonicalAt: null,
          redirectPolicy: "no_redirect",
        };
    },
    disable: async () => {
      calls.push("disable");
    },
  };
  const audit: AuditEventPort = {
    emit: async (e) => {
      calls.push(`audit:${e.action}`);
    },
  };
  return { registry, audit, calls };
}

function okAuthClient(calls: string[]): AuthClientDomainPort {
  return {
    addRedirectOrigin: async () => {
      calls.push("kc:add");
    },
    removeRedirectOrigin: async () => {
      calls.push("kc:remove");
    },
  };
}

describe("activateDomainAuthClient (ADR-ACT-0232)", () => {
  it("audit → keycloak mutation → registry active, in that order", async () => {
    const deps = fakeDeps(record());
    const result = await activateDomainAuthClient(
      { organisationId: "org-1", domain: "APP.acme.test", ...ACTOR },
      { ...deps, authClient: okAuthClient(deps.calls) }
    );
    assert.equal(result.kind, "ok");
    assert.deepEqual(deps.calls, [
      "audit:tenant_domains.auth_client.activated",
      "kc:add",
      "markAuthClientActive",
    ]);
  });

  it("a failed Keycloak mutation leaves the registry inactive", async () => {
    const deps = fakeDeps(record());
    const failing: AuthClientDomainPort = {
      addRedirectOrigin: async () => {
        throw new Error("kc down");
      },
      removeRedirectOrigin: async () => {},
    };
    await assert.rejects(() =>
      activateDomainAuthClient(
        { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
        { ...deps, authClient: failing }
      )
    );
    assert.ok(!deps.calls.includes("markAuthClientActive"));
  });

  it("refuses unverified ownership and unknown domains", async () => {
    const unverified = fakeDeps(record({ ownershipStatus: "pending_dns" }));
    assert.equal(
      (
        await activateDomainAuthClient(
          { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
          { ...unverified, authClient: okAuthClient(unverified.calls) }
        )
      ).kind,
      "not_verified"
    );
    assert.equal(unverified.calls.length, 0, "no audit/mutation on refused activation");

    const missing = fakeDeps(null);
    assert.equal(
      (
        await activateDomainAuthClient(
          { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
          { ...missing, authClient: okAuthClient(missing.calls) }
        )
      ).kind,
      "not_found"
    );
  });
});

describe("deactivateDomainAuthClient (ADR-ACT-0232)", () => {
  it("removes from keycloak then clears active/canonical/routing state", async () => {
    const deps = fakeDeps(
      record({
        authClientStatus: "active",
        canonical: true,
        routingStatus: "routing_local_active",
      })
    );
    const result = await deactivateDomainAuthClient(
      { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
      { ...deps, authClient: okAuthClient(deps.calls) }
    );
    assert.equal(result.kind, "ok");
    assert.deepEqual(deps.calls, [
      "audit:tenant_domains.auth_client.deactivated",
      "kc:remove",
      "markAuthClientInactive",
    ]);
  });

  it("refuses an inactive domain", async () => {
    const deps = fakeDeps(record());
    const result = await deactivateDomainAuthClient(
      { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
      { ...deps, authClient: okAuthClient(deps.calls) }
    );
    assert.equal(result.kind, "not_active");
    assert.equal(deps.calls.length, 0);
  });
});

describe("probeDomainLocalRouting (ADR-ACT-0232 — no fake readiness)", () => {
  function probeReturning(result: {
    reachable: boolean;
    tenantContextMatched: boolean;
  }): LocalRoutingProbePort {
    return { probe: async () => result };
  }

  it("a positive live probe records routing_local_active (audited)", async () => {
    const deps = fakeDeps(record({ authClientStatus: "active" }));
    const outcome = await probeDomainLocalRouting(
      { organisationId: "org-1", domain: "app.acme.test", expectedSlug: "acme", ...ACTOR },
      { ...deps, probe: probeReturning({ reachable: true, tenantContextMatched: true }) }
    );
    assert.ok(!("kind" in outcome));
    assert.equal(outcome.routing, "routing_local_active");
    assert.ok(deps.calls.includes("markRoutingLocalActive"));
    assert.ok(deps.calls.includes("audit:tenant_domains.routing.local_proven"));
  });

  it("an unreachable or mismatched probe records NOTHING", async () => {
    for (const probeResult of [
      { reachable: false, tenantContextMatched: false },
      { reachable: true, tenantContextMatched: false },
    ]) {
      const deps = fakeDeps(record({ authClientStatus: "active" }));
      const outcome = await probeDomainLocalRouting(
        { organisationId: "org-1", domain: "app.acme.test", expectedSlug: "acme", ...ACTOR },
        { ...deps, probe: probeReturning(probeResult) }
      );
      assert.ok(!("kind" in outcome));
      assert.equal(outcome.routing, "routing_unknown");
      assert.ok(!deps.calls.includes("markRoutingLocalActive"));
    }
  });
});

describe("setCanonicalDomain (ADR-ACT-0232)", () => {
  it("requires verified + active + proven routing", async () => {
    const deps = fakeDeps(record({ authClientStatus: "active" })); // routing unknown
    const result = await setCanonicalDomain(
      { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
      deps
    );
    assert.equal(result.kind, "routing_not_proven");
    assert.equal(deps.calls.length, 0);
  });

  it("sets canonical for a fully proven domain and marks redirect policy", async () => {
    const deps = fakeDeps(
      record({ authClientStatus: "active", routingStatus: "routing_local_active" })
    );
    const result = await setCanonicalDomain(
      { organisationId: "org-1", domain: "app.acme.test", ...ACTOR },
      deps
    );
    assert.equal(result.kind, "ok");
    assert.ok(result.kind === "ok" && result.record.canonical);
    assert.ok(
      result.kind === "ok" && result.record.redirectPolicy === "redirect_slug_to_canonical"
    );
    assert.deepEqual(deps.calls, ["audit:tenant_domains.canonical.set", "setCanonical"]);
  });
});
