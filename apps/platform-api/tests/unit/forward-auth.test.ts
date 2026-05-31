/**
 * forward-auth handler unit tests (ADR-0029, ADR-0030, ADR-0031)
 *
 * Coverage:
 * - Secret validation: missing in production ? 503; wrong ? 403
 * - Session: no session/cookie ? 401
 * - Access logic via checkResourceAccess (pure, no DB/Redis):
 *   - system-admin granted all SYSTEM_ADMIN_RESOURCES
 *   - system-admin denied unknown resources
 *   - tenant-admin granted own subdomain tenant resources
 *   - tenant-admin denied cross-tenant subdomain
 *   - tenant-admin denied on aldous.info root
 *   - tenant-admin denied for super-global-only resources
 * - Handler integration: fixture session paths ? correct status codes
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  checkResourceAccess,
  extractSlugFromHost,
  SYSTEM_ADMIN_RESOURCES,
  TENANT_ADMIN_RESOURCES,
} from "../../src/server/forward-auth.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawReq(url: string, headers: Record<string, string>): http.IncomingMessage {
  const req = new http.IncomingMessage(null as never);
  req.url = url;
  Object.assign(req, { headers: { host: "aldous.info", ...headers } });
  return req;
}

interface MockRes {
  status: number;
  body: unknown;
}

async function callHandler(
  url: string,
  headers: Record<string, string>
): Promise<MockRes | undefined> {
  const { handleForwardAuth } = await import("../../src/server/forward-auth.ts");
  const collected: MockRes[] = [];
  await handleForwardAuth(
    {
      raw: makeRawReq(url, headers),
      body: null,
      actor: null,
      context: {} as never,
      method: "GET",
      path: "/internal/auth/forward",
      requestId: "test",
    },
    {
      raw: null as never,
      json: (s: number, b: unknown) => collected.push({ status: s, body: b }),
    }
  );
  return collected[0];
}

// ---------------------------------------------------------------------------
// 1. extractSlugFromHost ? pure function
// ---------------------------------------------------------------------------

describe("extractSlugFromHost", () => {
  it("returns null for the root domain (super-global)", () => {
    assert.strictEqual(extractSlugFromHost("aldous.info"), null);
  });

  it("returns the slug for a tenant subdomain", () => {
    assert.strictEqual(extractSlugFromHost("acme.aldous.info"), "acme");
  });

  it("returns null for a non-matching domain", () => {
    assert.strictEqual(extractSlugFromHost("other.example.com"), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(extractSlugFromHost(""), null);
  });
});

// ---------------------------------------------------------------------------
// 2. checkResourceAccess ? pure decision logic (no DB / Redis)
// ---------------------------------------------------------------------------

describe("checkResourceAccess: system-admin", () => {
  it("grants access to every SYSTEM_ADMIN_RESOURCE from root host", () => {
    for (const resource of SYSTEM_ADMIN_RESOURCES) {
      assert.ok(
        checkResourceAccess({
          roles: ["system-admin"],
          resource,
          requestedSlug: null,
          ownSlug: null,
        }),
        `system-admin must be granted "${resource}"`
      );
    }
  });

  it("grants access from a tenant subdomain (cross-domain admin support)", () => {
    assert.ok(
      checkResourceAccess({
        roles: ["system-admin"],
        resource: "admin:sonarqube",
        requestedSlug: "acme",
        ownSlug: "acme",
      })
    );
  });

  it("denies unknown resource", () => {
    assert.ok(
      !checkResourceAccess({
        roles: ["system-admin"],
        resource: "admin:unknown-tool",
        requestedSlug: null,
        ownSlug: null,
      })
    );
  });
});

describe("checkResourceAccess: tenant-admin", () => {
  const resource = [...TENANT_ADMIN_RESOURCES][0]!;

  it("grants access when requestedSlug === ownSlug", () => {
    assert.ok(
      checkResourceAccess({
        roles: ["tenant-admin"],
        resource,
        requestedSlug: "acme",
        ownSlug: "acme",
      }),
      `tenant-admin must be granted ${resource} on own subdomain`
    );
  });

  it("denies cross-tenant: requestedSlug differs from ownSlug", () => {
    assert.ok(
      !checkResourceAccess({
        roles: ["tenant-admin"],
        resource,
        requestedSlug: "other",
        ownSlug: "acme",
      })
    );
  });

  it("denies on super-global root (requestedSlug is null)", () => {
    assert.ok(
      !checkResourceAccess({
        roles: ["tenant-admin"],
        resource,
        requestedSlug: null,
        ownSlug: "acme",
      })
    );
  });

  it("denies when ownSlug is null (DB lookup failed)", () => {
    assert.ok(
      !checkResourceAccess({
        roles: ["tenant-admin"],
        resource,
        requestedSlug: "acme",
        ownSlug: null,
      })
    );
  });

  it("denies admin:sonarqube (super-global-only, not in TENANT_ADMIN_RESOURCES)", () => {
    assert.ok(
      !checkResourceAccess({
        roles: ["tenant-admin"],
        resource: "admin:sonarqube",
        requestedSlug: "acme",
        ownSlug: "acme",
      })
    );
  });

  it("denies with empty roles", () => {
    assert.ok(
      !checkResourceAccess({ roles: [], resource, requestedSlug: "acme", ownSlug: "acme" })
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Handler: X-Internal-Secret validation
// ---------------------------------------------------------------------------

describe("handleForwardAuth: X-Internal-Secret", () => {
  const saved = {
    NODE_ENV: process.env["NODE_ENV"],
    CADDY: process.env["CADDY_INTERNAL_SECRET"],
  };

  beforeEach(() => {
    process.env["NODE_ENV"] = "production";
    process.env["CADDY_INTERNAL_SECRET"] = "correct-secret-32-chars-long-ok!";
  });

  afterEach(() => {
    process.env["NODE_ENV"] = saved.NODE_ENV;
    if (saved.CADDY === undefined) delete process.env["CADDY_INTERNAL_SECRET"];
    else process.env["CADDY_INTERNAL_SECRET"] = saved.CADDY;
  });

  it("503 MISCONFIGURED when secret empty in production", async () => {
    process.env["CADDY_INTERNAL_SECRET"] = "";
    const r = await callHandler("/internal/auth/forward?resource=admin:sonarqube&scope=read", {});
    assert.strictEqual(r?.status, 503);
    assert.strictEqual((r?.body as Record<string, unknown>)?.["code"], "MISCONFIGURED");
  });

  it("403 FORBIDDEN when X-Internal-Secret is wrong", async () => {
    const r = await callHandler("/internal/auth/forward?resource=admin:sonarqube&scope=read", {
      "x-internal-secret": "wrong-secret",
    });
    assert.strictEqual(r?.status, 403);
    assert.strictEqual((r?.body as Record<string, unknown>)?.["code"], "FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// 4. Handler: session / fixture paths
// ---------------------------------------------------------------------------

describe("handleForwardAuth: session handling", () => {
  const saved = {
    FIXTURE: process.env["LOCAL_FIXTURE_SESSION"],
    CADDY: process.env["CADDY_INTERNAL_SECRET"],
    NODE_ENV: process.env["NODE_ENV"],
  };

  afterEach(() => {
    if (saved.FIXTURE === undefined) delete process.env["LOCAL_FIXTURE_SESSION"];
    else process.env["LOCAL_FIXTURE_SESSION"] = saved.FIXTURE;
    if (saved.CADDY === undefined) delete process.env["CADDY_INTERNAL_SECRET"];
    else process.env["CADDY_INTERNAL_SECRET"] = saved.CADDY;
    process.env["NODE_ENV"] = saved.NODE_ENV;
  });

  it("401 UNAUTHENTICATED when no fixture and no cookie", async () => {
    delete process.env["LOCAL_FIXTURE_SESSION"];
    process.env["CADDY_INTERNAL_SECRET"] = "";
    process.env["NODE_ENV"] = "development";

    const r = await callHandler("/internal/auth/forward?resource=admin:sonarqube&scope=read", {
      host: "aldous.info",
    });
    assert.strictEqual(r?.status, 401);
    assert.strictEqual((r?.body as Record<string, unknown>)?.["code"], "UNAUTHENTICATED");
  });

  it("403 tenant-admin fixture denied on aldous.info root (super-global resource)", async () => {
    // tenant-admin role + admin:sonarqube (not in TENANT_ADMIN_RESOURCES) + root host
    // ? all paths lead to 403
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";
    process.env["CADDY_INTERNAL_SECRET"] = "";
    process.env["NODE_ENV"] = "development";

    const r = await callHandler("/internal/auth/forward?resource=admin:sonarqube&scope=read", {
      host: "aldous.info",
    });
    assert.strictEqual(r?.status, 403, "tenant-admin must be denied on aldous.info root");
  });

  it("403 tenant-admin fixture denied for super-global-only resource from any subdomain", async () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";
    process.env["CADDY_INTERNAL_SECRET"] = "";
    process.env["NODE_ENV"] = "development";

    // admin:sonarqube is SYSTEM_ADMIN only; tenant-admin cannot access it from own subdomain
    const r = await callHandler("/internal/auth/forward?resource=admin:sonarqube&scope=read", {
      host: "fixture-org.aldous.info",
    });
    assert.strictEqual(r?.status, 403);
  });
});

// ---------------------------------------------------------------------------
// 5. Clickthrough service classification
// ---------------------------------------------------------------------------

describe("checkResourceAccess — GLOBAL_ONLY services (tenant-admin must be denied)", () => {
  const globalOnlyServices = [
    "admin:pgadmin",
    "admin:minio",
    "admin:sonarqube",
    "admin:wiremock",
    "admin:clickhouse",
    "admin:localstack",
    "admin:tilt",
  ];

  for (const service of globalOnlyServices) {
    it(`tenant-admin denied ${service} on own slug`, () => {
      assert.ok(
        !checkResourceAccess({
          roles: ["tenant-admin"],
          resource: service,
          requestedSlug: "acme",
          ownSlug: "acme",
        }),
        `${service} must be GLOBAL_ONLY — tenant-admin must not have access`
      );
    });

    it(`system-admin allowed ${service}`, () => {
      assert.ok(
        checkResourceAccess({
          roles: ["system-admin"],
          resource: service,
          requestedSlug: null,
          ownSlug: null,
        }),
        `${service} must be accessible to system-admin`
      );
    });
  }
});

describe("checkResourceAccess — TENANT_SCOPED_SAFE services", () => {
  const tenantSafeServices = ["admin:keycloak", "admin:mailpit", "admin:sentry"];

  for (const service of tenantSafeServices) {
    it(`tenant-admin allowed ${service} on own slug`, () => {
      assert.ok(
        checkResourceAccess({
          roles: ["tenant-admin"],
          resource: service,
          requestedSlug: "acme",
          ownSlug: "acme",
        }),
        `${service} must be TENANT_SCOPED_SAFE — tenant-admin must have access on own slug`
      );
    });

    it(`tenant-admin denied ${service} on different slug`, () => {
      assert.ok(
        !checkResourceAccess({
          roles: ["tenant-admin"],
          resource: service,
          requestedSlug: "other",
          ownSlug: "acme",
        }),
        `${service} — tenant-admin must not access another tenant`
      );
    });
  }
});

describe("SYSTEM_ADMIN_RESOURCES and TENANT_ADMIN_RESOURCES set membership", () => {
  it("admin:pgadmin is in SYSTEM_ADMIN_RESOURCES", () => {
    assert.ok(SYSTEM_ADMIN_RESOURCES.has("admin:pgadmin"));
  });

  it("admin:pgadmin is NOT in TENANT_ADMIN_RESOURCES", () => {
    assert.ok(!TENANT_ADMIN_RESOURCES.has("admin:pgadmin"));
  });

  it("admin:minio is NOT in TENANT_ADMIN_RESOURCES", () => {
    assert.ok(!TENANT_ADMIN_RESOURCES.has("admin:minio"));
  });
});
