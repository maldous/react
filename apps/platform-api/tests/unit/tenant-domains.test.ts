/**
 * Unit tests for ADR-0048 / ADR-ACT-0217 — tenant custom domains read + readiness.
 * Pure: mapDomainRows + computeDomainReadiness are deterministic functions of rows.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapDomainRows,
  computeDomainReadiness,
  classifyLocalRouting,
  type DomainChallengeRow,
} from "../../src/usecases/tenant-domains.ts";
import { extractSlugFromHost } from "../../src/server/tenant-resolver.ts";

const T0 = new Date("2026-06-01T00:00:00.000Z");
const T1 = new Date("2026-06-02T00:00:00.000Z");
const EXPIRES = new Date("2026-06-03T00:00:00.000Z");

function row(over: Partial<DomainChallengeRow> & { domain: string }): DomainChallengeRow {
  return {
    created_at: T0,
    expires_at: EXPIRES,
    verified_at: null,
    consumed_at: null,
    ...over,
  };
}

describe("mapDomainRows (ADR-0048)", () => {
  it("an unverified challenge is pending_dns, routing_unknown, tls_unknown", () => {
    const [d] = mapDomainRows([row({ domain: "app.acme.test" })]);
    assert.equal(d?.status, "pending_dns");
    assert.equal(d?.routing, "routing_unknown");
    assert.equal(d?.tls, "tls_unknown");
    assert.equal(d?.txtRecord, "_aldous-verify.app.acme.test");
    assert.equal(d?.verifiedAt, null);
  });

  it("a verified (unconsumed) challenge is verified but routing stays unknown", () => {
    const [d] = mapDomainRows([row({ domain: "app.acme.test", verified_at: T1 })]);
    assert.equal(d?.status, "verified");
    assert.equal(d?.routing, "routing_unknown");
    assert.equal(d?.verifiedAt, T1.toISOString());
  });

  it("a verified + consumed challenge is verified; routing stays unknown (ADR-ACT-0225)", () => {
    // Being added to the auth client (consumed) is NOT proof that traffic routes;
    // routing_active (public) is never inferred from DB state.
    const [d] = mapDomainRows([row({ domain: "app.acme.test", verified_at: T1, consumed_at: T1 })]);
    assert.equal(d?.status, "verified");
    assert.equal(d?.routing, "routing_unknown");
  });

  it("never claims TLS readiness — always tls_unknown", () => {
    for (const r of mapDomainRows([
      row({ domain: "a.acme.test", verified_at: T1, consumed_at: T1 }),
      row({ domain: "b.acme.test" }),
    ])) {
      assert.equal(r.tls, "tls_unknown");
    }
  });

  it("collapses multiple rows per domain — a verified row wins over a pending re-challenge", () => {
    const rows = [
      row({ domain: "app.acme.test", verified_at: T1, consumed_at: T1 }),
      row({ domain: "app.acme.test" }), // a later pending re-challenge
    ];
    const mapped = mapDomainRows(rows);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]?.status, "verified");
    assert.equal(mapped[0]?.routing, "routing_unknown");
  });

  it("returns one stable, alphabetically-ordered entry per domain", () => {
    const mapped = mapDomainRows([
      row({ domain: "zeta.acme.test" }),
      row({ domain: "alpha.acme.test", verified_at: T1 }),
    ]);
    assert.deepEqual(
      mapped.map((d) => d.domain),
      ["alpha.acme.test", "zeta.acme.test"]
    );
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
    const domains = mapDomainRows([row({ domain: "app.acme.test" })]);
    const r = computeDomainReadiness(domains);
    assert.equal(r.status, "pending_verification");
    assert.equal(r.total, 1);
    assert.equal(r.verified, 0);
    assert.equal(r.pending, 1);
  });

  it("at least one verified domain → verified", () => {
    const domains = mapDomainRows([
      row({ domain: "app.acme.test", verified_at: T1 }),
      row({ domain: "other.acme.test" }),
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
