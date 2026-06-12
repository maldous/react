/**
 * Unit tests for ADR-0048 / ADR-ACT-0217 / ADR-ACT-0232 — tenant custom
 * domains read + readiness over the tenant_domains lifecycle registry.
 * Pure: mapRegistryRecords + computeDomainReadiness are deterministic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapRegistryRecords,
  computeDomainReadiness,
  classifyLocalRouting,
} from "../../src/usecases/tenant-domains.ts";
import {
  canActivateAuthClient,
  canSetCanonical,
} from "../../src/usecases/tenant-domain-lifecycle.ts";
import type { TenantDomainRecord } from "../../src/ports/tenant-domain-registry.ts";
import { extractSlugFromHost } from "../../src/server/tenant-resolver.ts";

const T0 = new Date("2026-06-01T00:00:00.000Z");
const T1 = new Date("2026-06-02T00:00:00.000Z");
const EXPIRES = new Date("2026-06-03T00:00:00.000Z");

function record(over: Partial<TenantDomainRecord> & { domain: string }): TenantDomainRecord {
  return {
    organisationId: "org-1",
    source: "custom",
    ownershipStatus: "pending_dns",
    authClientStatus: "inactive",
    routingStatus: "routing_unknown",
    tlsStatus: "tls_unknown",
    canonical: false,
    redirectPolicy: "no_redirect",
    createdAt: T0,
    verifiedAt: null,
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

describe("mapRegistryRecords (ADR-ACT-0232)", () => {
  it("a pending registry row is pending_dns / inactive / routing_unknown / tls_unknown", () => {
    const [d] = mapRegistryRecords([record({ domain: "app.acme.test" })]);
    assert.equal(d?.status, "pending_dns");
    assert.equal(d?.authClient, "inactive");
    assert.equal(d?.routing, "routing_unknown");
    assert.equal(d?.tls, "tls_unknown");
    assert.equal(d?.canonical, false);
    assert.equal(d?.redirectPolicy, "no_redirect");
    assert.equal(d?.txtRecord, "_aldous-verify.app.acme.test");
    assert.equal(d?.verifiedAt, null);
  });

  it("a verified row is verified but routing stays unknown (no inference)", () => {
    const [d] = mapRegistryRecords([
      record({ domain: "app.acme.test", ownershipStatus: "verified", verifiedAt: T1 }),
    ]);
    assert.equal(d?.status, "verified");
    assert.equal(d?.routing, "routing_unknown");
    assert.equal(d?.verifiedAt, T1.toISOString());
  });

  it("auth-client activation does NOT imply routing (ADR-ACT-0225 honesty rule)", () => {
    const [d] = mapRegistryRecords([
      record({
        domain: "app.acme.test",
        ownershipStatus: "verified",
        verifiedAt: T1,
        authClientStatus: "active",
        authClientActivatedAt: T1,
      }),
    ]);
    assert.equal(d?.authClient, "active");
    assert.equal(d?.routing, "routing_unknown");
    assert.equal(d?.tls, "tls_unknown");
  });

  it("a persisted local routing proof surfaces as routing_local_active with its proven-at", () => {
    const [d] = mapRegistryRecords([
      record({
        domain: "app.acme.test",
        ownershipStatus: "verified",
        authClientStatus: "active",
        routingStatus: "routing_local_active",
        routingLocalProvenAt: T1,
      }),
    ]);
    assert.equal(d?.routing, "routing_local_active");
    assert.equal(d?.routingLocalProvenAt, T1.toISOString());
    assert.equal(d?.routingPublicProvenAt, null);
  });

  it("dns_mismatch is surfaced honestly", () => {
    const [d] = mapRegistryRecords([
      record({ domain: "app.acme.test", ownershipStatus: "dns_mismatch" }),
    ]);
    assert.equal(d?.status, "dns_mismatch");
  });

  it("challenge expiry is joined per domain", () => {
    const [d] = mapRegistryRecords(
      [record({ domain: "app.acme.test" })],
      new Map([["app.acme.test", EXPIRES]])
    );
    assert.equal(d?.expiresAt, EXPIRES.toISOString());
  });

  it("canonical flag + timestamp pass through", () => {
    const [d] = mapRegistryRecords([
      record({ domain: "app.acme.test", canonical: true, canonicalAt: T1 }),
    ]);
    assert.equal(d?.canonical, true);
    assert.equal(d?.canonicalAt, T1.toISOString());
  });
});

describe("computeDomainReadiness (ADR-0048)", () => {
  it("no domains → no_domains", () => {
    assert.deepEqual(computeDomainReadiness([]), {
      status: "no_domains",
      total: 0,
      verified: 0,
      pending: 0,
    });
  });

  it("domains exist but none verified → pending_verification", () => {
    const domains = mapRegistryRecords([record({ domain: "app.acme.test" })]);
    const r = computeDomainReadiness(domains);
    assert.equal(r.status, "pending_verification");
    assert.equal(r.total, 1);
    assert.equal(r.verified, 0);
    assert.equal(r.pending, 1);
  });

  it("at least one verified domain → verified", () => {
    const domains = mapRegistryRecords([
      record({ domain: "app.acme.test", ownershipStatus: "verified", verifiedAt: T1 }),
      record({ domain: "other.acme.test" }),
    ]);
    const r = computeDomainReadiness(domains);
    assert.equal(r.status, "verified");
    assert.equal(r.total, 2);
    assert.equal(r.verified, 1);
    assert.equal(r.pending, 1);
  });
});

describe("classifyLocalRouting (ADR-ACT-0225)", () => {
  it("routing_local_active only when reachable AND tenant context matched", () => {
    assert.equal(
      classifyLocalRouting({ reachable: true, tenantContextMatched: true }),
      "routing_local_active"
    );
  });
  it("routing_unknown when unreachable or the wrong/absent tenant context", () => {
    assert.equal(
      classifyLocalRouting({ reachable: false, tenantContextMatched: false }),
      "routing_unknown"
    );
    assert.equal(
      classifyLocalRouting({ reachable: true, tenantContextMatched: false }),
      "routing_unknown"
    );
  });
});

describe("canActivateAuthClient (ADR-ACT-0232 pure guard)", () => {
  it("requires an existing, enabled row", () => {
    assert.deepEqual(canActivateAuthClient(null), { ok: false, reason: "not_found" });
    assert.deepEqual(canActivateAuthClient(record({ domain: "a.t", disabledAt: T1 })), {
      ok: false,
      reason: "not_found",
    });
  });
  it("requires DNS-verified ownership", () => {
    assert.deepEqual(canActivateAuthClient(record({ domain: "a.t" })), {
      ok: false,
      reason: "not_verified",
    });
    assert.deepEqual(
      canActivateAuthClient(record({ domain: "a.t", ownershipStatus: "dns_mismatch" })),
      { ok: false, reason: "not_verified" }
    );
  });
  it("rejects double activation", () => {
    assert.deepEqual(
      canActivateAuthClient(
        record({ domain: "a.t", ownershipStatus: "verified", authClientStatus: "active" })
      ),
      { ok: false, reason: "already_active" }
    );
  });
  it("allows verified + inactive", () => {
    assert.deepEqual(
      canActivateAuthClient(record({ domain: "a.t", ownershipStatus: "verified" })),
      {
        ok: true,
      }
    );
  });
});

describe("canSetCanonical (ADR-ACT-0232 pure guard)", () => {
  it("requires verified ownership, active auth client, and proven routing — in that order", () => {
    assert.deepEqual(canSetCanonical(null), { ok: false, reason: "not_found" });
    assert.deepEqual(canSetCanonical(record({ domain: "a.t" })), {
      ok: false,
      reason: "not_verified",
    });
    assert.deepEqual(canSetCanonical(record({ domain: "a.t", ownershipStatus: "verified" })), {
      ok: false,
      reason: "auth_client_inactive",
    });
    assert.deepEqual(
      canSetCanonical(
        record({ domain: "a.t", ownershipStatus: "verified", authClientStatus: "active" })
      ),
      { ok: false, reason: "routing_not_proven" }
    );
  });
  it("allows locally proven routing (labelled local) and public routing", () => {
    for (const routingStatus of ["routing_local_active", "routing_active"] as const) {
      assert.deepEqual(
        canSetCanonical(
          record({
            domain: "a.t",
            ownershipStatus: "verified",
            authClientStatus: "active",
            routingStatus,
          })
        ),
        { ok: true }
      );
    }
  });
});

describe("extractSlugFromHost — port handling (ADR-ACT-0225)", () => {
  it("strips a :port before matching the apex (local/test on non-standard ports)", () => {
    assert.equal(extractSlugFromHost("acme.test.localhost:8081", "test.localhost"), "acme");
    assert.equal(extractSlugFromHost("acme.aldous.info", "aldous.info"), "acme");
  });
  it("returns null for the apex itself (with or without port) and unknown apex", () => {
    assert.equal(extractSlugFromHost("test.localhost:8081", "test.localhost"), null);
    assert.equal(extractSlugFromHost("evil.example.com:8081", "test.localhost"), null);
  });
});
