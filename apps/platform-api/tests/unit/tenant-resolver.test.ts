import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type pg from "pg";
import {
  extractSlugFromHost,
  isGlobalHost,
  isApexSubdomain,
  requestHostFromHeaders,
  resolveTenantFromRequest,
  resolveOrganisationByActiveCustomDomain,
} from "../../src/server/tenant-resolver.ts";

describe("extractSlugFromHost — production apex (aldous.info)", () => {
  const apex = "aldous.info";

  it("returns null for the apex itself (global host)", () => {
    assert.equal(extractSlugFromHost("aldous.info", apex), null);
  });

  it("returns the slug for a valid tenant subdomain", () => {
    assert.equal(extractSlugFromHost("tenant1.aldous.info", apex), "tenant1");
    assert.equal(extractSlugFromHost("acme-corp.aldous.info", apex), "acme-corp");
  });

  it("returns null for reserved slugs", () => {
    assert.equal(extractSlugFromHost("staging.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("admin.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("api.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("kc.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("pgadmin.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("platform.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("aldous.aldous.info", apex), null);
  });

  it("returns null for unrelated hosts", () => {
    assert.equal(extractSlugFromHost("evil.com", apex), null);
    assert.equal(extractSlugFromHost("aldous.info.evil.com", apex), null);
  });

  it("returns null for empty string", () => {
    assert.equal(extractSlugFromHost("", apex), null);
  });
});

describe("extractSlugFromHost — staging apex (staging.aldous.info)", () => {
  const apex = "staging.aldous.info";

  it("returns null for the staging apex itself (global staging host)", () => {
    assert.equal(extractSlugFromHost("staging.aldous.info", apex), null);
  });

  it("returns the slug for a valid tenant staging subdomain", () => {
    assert.equal(extractSlugFromHost("tenant1.staging.aldous.info", apex), "tenant1");
  });

  it("returns null for production tenant subdomains when apex is staging", () => {
    assert.equal(extractSlugFromHost("tenant1.aldous.info", apex), null);
  });

  it("returns null for reserved slugs under staging apex", () => {
    assert.equal(extractSlugFromHost("admin.staging.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("api.staging.aldous.info", apex), null);
  });
});

describe("isGlobalHost", () => {
  it("returns true for the production apex", () => {
    assert.ok(isGlobalHost("aldous.info", "aldous.info"));
  });

  it("returns true for the staging apex", () => {
    assert.ok(isGlobalHost("staging.aldous.info", "staging.aldous.info"));
  });

  it("returns true when host has a port", () => {
    assert.ok(isGlobalHost("aldous.info:3001", "aldous.info"));
  });

  it("returns false for tenant subdomains under production apex", () => {
    assert.ok(!isGlobalHost("tenant1.aldous.info", "aldous.info"));
  });

  it("returns false for tenant subdomains under staging apex", () => {
    assert.ok(!isGlobalHost("tenant1.staging.aldous.info", "staging.aldous.info"));
  });

  it("returns false for production subdomain when apex is staging", () => {
    assert.ok(!isGlobalHost("tenant1.aldous.info", "staging.aldous.info"));
  });

  it("returns false for unrelated hosts", () => {
    assert.ok(!isGlobalHost("evil.com", "aldous.info"));
  });
});

// ---------------------------------------------------------------------------
// ADR-ACT-0231: port handling, apex-subdomain predicate, header derivation,
// and custom-domain resolution (stub pool — no live DB needed).
// ---------------------------------------------------------------------------

function fakeReq(headers: Record<string, string>): http.IncomingMessage {
  const req = new http.IncomingMessage(null as never);
  Object.assign(req, { headers });
  return req;
}

/** Stub pool: organisations.slug + tenant_domains active-custom-domain lookups. */
function stubPool(opts: {
  slugs?: Record<string, { id: string; slug: string }>;
  activeCustomDomains?: Record<string, { id: string; slug: string }>;
}): pg.Pool {
  return {
    query: async (text: string, params: unknown[]) => {
      const key = String(params?.[0] ?? "");
      if (text.includes("FROM public.organisations")) {
        const row = opts.slugs?.[key];
        return { rows: row ? [row] : [] };
      }
      if (text.includes("FROM public.tenant_domains")) {
        const row = opts.activeCustomDomains?.[key];
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
  } as unknown as pg.Pool;
}

describe("extractSlugFromHost — port handling (ADR-ACT-0225/0231)", () => {
  it("strips the port before matching", () => {
    assert.equal(extractSlugFromHost("acme.test.localhost:8081", "test.localhost"), "acme");
    assert.equal(extractSlugFromHost("test.localhost:8081", "test.localhost"), null);
  });

  it("returns null for malformed hosts", () => {
    assert.equal(extractSlugFromHost("bad host.aldous.info", "aldous.info"), null);
    assert.equal(extractSlugFromHost("acme.aldous.info:port", "aldous.info"), null);
  });
});

describe("isApexSubdomain (ADR-ACT-0231 global-scope hardening)", () => {
  it("true for tenant, reserved, and unknown/invalid subdomains of the apex", () => {
    assert.ok(isApexSubdomain("acme.aldous.info", "aldous.info"));
    assert.ok(isApexSubdomain("kc.aldous.info", "aldous.info"));
    assert.ok(isApexSubdomain("a.b.aldous.info", "aldous.info"));
  });

  it("false for the apex itself and for non-apex hosts", () => {
    assert.ok(!isApexSubdomain("aldous.info", "aldous.info"));
    assert.ok(!isApexSubdomain("localhost", "aldous.info"));
    assert.ok(!isApexSubdomain("app.mycorp.example", "aldous.info"));
  });
});

describe("requestHostFromHeaders", () => {
  it("prefers X-Forwarded-Host over Host", () => {
    const req = fakeReq({ host: "platform-api:3001", "x-forwarded-host": "acme.aldous.info" });
    assert.equal(requestHostFromHeaders(req), "acme.aldous.info");
  });

  it("takes the first hop of a comma-separated X-Forwarded-Host", () => {
    const req = fakeReq({ host: "x", "x-forwarded-host": "acme.aldous.info, proxy.internal" });
    assert.equal(requestHostFromHeaders(req), "acme.aldous.info");
  });

  it("falls back to Host", () => {
    assert.equal(requestHostFromHeaders(fakeReq({ host: "aldous.info" })), "aldous.info");
  });
});

describe("resolveTenantFromRequest — custom domains (ADR-ACT-0231)", () => {
  const orgA = { id: "00000000-0000-4000-8000-00000000000a", slug: "acme" };

  it("resolves a slug host via organisations (hostSource slug)", async () => {
    process.env["APEX_DOMAIN"] = "aldous.info";
    const ctx = await resolveTenantFromRequest(
      fakeReq({ host: "acme.aldous.info" }),
      stubPool({ slugs: { acme: orgA } })
    );
    assert.equal(ctx?.organisationId, orgA.id);
    assert.equal(ctx?.hostSource, "slug");
    assert.equal(ctx?.realmName, `tenant-${orgA.id}`);
  });

  it("resolves an ACTIVE custom domain (hostSource custom_domain)", async () => {
    const ctx = await resolveTenantFromRequest(
      fakeReq({ host: "app.mycorp.example" }),
      stubPool({ activeCustomDomains: { "app.mycorp.example": orgA } })
    );
    assert.equal(ctx?.organisationId, orgA.id);
    assert.equal(ctx?.hostSource, "custom_domain");
    assert.equal(ctx?.slug, "acme");
  });

  it("does NOT resolve a custom domain absent from the registry (unknown host)", async () => {
    const ctx = await resolveTenantFromRequest(
      fakeReq({ host: "app.mycorp.example" }),
      stubPool({}) // registry returns no row (covers verified-but-not-activated too)
    );
    assert.equal(ctx, null);
  });

  it("returns null for apex, reserved, and malformed hosts", async () => {
    const pool = stubPool({ slugs: { acme: orgA } });
    for (const host of ["aldous.info", "kc.aldous.info", "bad host", ""]) {
      assert.equal(await resolveTenantFromRequest(fakeReq({ host }), pool), null, host);
    }
  });

  it("custom domain for tenant A never yields tenant B (registry row is the only source)", async () => {
    const orgB = { id: "00000000-0000-4000-8000-00000000000b", slug: "globex" };
    const ctx = await resolveTenantFromRequest(
      fakeReq({ host: "app.mycorp.example" }),
      stubPool({
        slugs: { globex: orgB },
        activeCustomDomains: { "app.mycorp.example": orgA },
      })
    );
    assert.equal(ctx?.organisationId, orgA.id);
  });
});

describe("resolveOrganisationByActiveCustomDomain — error safety", () => {
  it("returns null when the registry table is unreachable", async () => {
    const pool = {
      query: async () => {
        throw new Error("relation does not exist");
      },
    } as unknown as pg.Pool;
    assert.equal(await resolveOrganisationByActiveCustomDomain(pool, "x.example"), null);
  });
});
