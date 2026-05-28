/**
 * Organisation profile endpoint tests.
 * Tests GET /api/organisation/profile and PATCH /api/organisation/profile
 * using a real HTTP server (port 0) and real Postgres.
 *
 * Requires: Postgres running at POSTGRES_URL (default: localhost:5433).
 * Run: npm run test:platform-api (includes this file).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "../../src/server/pipeline.ts";
import {
  handleGetOrganisationProfile,
  handlePatchOrganisationProfile,
} from "../../src/server/organisation.ts";
import { getHealth, getReadiness, getVersion } from "../../src/server/health.ts";
import { getFixtureSession } from "../../src/server/session.ts";

// --- Server helpers ---

const routes = [
  {
    method: "GET",
    path: "/healthz",
    handler: async (_req: unknown, res: { json: (s: number, b: unknown) => void }) =>
      res.json(200, getHealth()),
  },
  {
    method: "GET",
    path: "/readyz",
    handler: async (_req: unknown, res: { json: (s: number, b: unknown) => void }) => {
      const result = await getReadiness();
      res.json(result.status === "ready" ? 200 : 503, result);
    },
  },
  {
    method: "GET",
    path: "/version",
    handler: async (_req: unknown, res: { json: (s: number, b: unknown) => void }) =>
      res.json(200, getVersion()),
  },
  {
    method: "GET",
    path: "/api/session",
    handler: async (_req: unknown, res: { json: (s: number, b: unknown) => void }) => {
      const actor = getFixtureSession();
      if (actor) res.json(200, actor);
      else res.json(401, { code: "UNAUTHENTICATED", message: "No session" });
    },
  },
  {
    method: "GET",
    path: "/api/organisation/profile",
    requiresAuth: true as const,
    requiredPermission: "organisation.read",
    handler: handleGetOrganisationProfile,
  },
  {
    method: "PATCH",
    path: "/api/organisation/profile",
    requiresAuth: true as const,
    requiredPermission: "organisation.update",
    handler: handlePatchOrganisationProfile,
  },
];

function makeServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const router = createRouter(routes);
    const server = http.createServer(router);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not get server address"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Helpers for env management
function setFixtureRole(role: string | undefined) {
  if (role === undefined) {
    delete process.env["LOCAL_FIXTURE_SESSION"];
  } else {
    process.env["LOCAL_FIXTURE_SESSION"] = role;
  }
}

// --- Test suite ---

describe("organisation profile: GET /api/organisation/profile", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("tenant-admin: 200 with profile data", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      id: string;
      slug: string;
      displayName: string;
      createdAt: string;
      updatedAt: string;
    };
    assert.equal(body.id, "00000000-0000-0000-0000-000000000001");
    assert.equal(body.slug, "fixture-org");
    assert.equal(typeof body.displayName, "string");
    assert.ok(body.displayName.length > 0);
  });

  it("viewer: 200 with profile data", async () => {
    setFixtureRole("viewer");
    const res = await fetch(`${url}/api/organisation/profile`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; slug: string };
    assert.equal(body.id, "00000000-0000-0000-0000-000000000001");
    assert.equal(body.slug, "fixture-org");
  });

  it("unauthenticated: 401", async () => {
    setFixtureRole(undefined);
    const res = await fetch(`${url}/api/organisation/profile`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "UNAUTHORIZED");
  });

  it("no-permissions: 403", async () => {
    setFixtureRole("no-permissions");
    const res = await fetch(`${url}/api/organisation/profile`);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "FORBIDDEN");
  });

  it("X-Request-Id present in success response", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`);
    assert.equal(res.status, 200);
    const requestId = res.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id header should be present");
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("X-Request-Id present in 401 error response", async () => {
    setFixtureRole(undefined);
    const res = await fetch(`${url}/api/organisation/profile`);
    assert.equal(res.status, 401);
    const requestId = res.headers.get("x-request-id");
    assert.ok(requestId, "X-Request-Id header should be present on error");
  });
});

describe("organisation profile: PATCH /api/organisation/profile", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) {
      process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    } else {
      delete process.env["LOCAL_FIXTURE_SESSION"];
    }
    await closeServer(server);
  });

  it("tenant-admin: 200 updates display name", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Updated Fixture Org" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { displayName: string; id: string; slug: string };
    assert.equal(body.displayName, "Updated Fixture Org");
    assert.equal(body.id, "00000000-0000-0000-0000-000000000001");

    // Restore original display name
    const restore = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Fixture Organisation" }),
    });
    assert.equal(restore.status, 200);
  });

  it("viewer: 403 (lacks organisation.update)", async () => {
    setFixtureRole("viewer");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Should Not Update" }),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "FORBIDDEN");
  });

  it("unauthenticated: 401", async () => {
    setFixtureRole(undefined);
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Should Not Update" }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "UNAUTHORIZED");
  });

  it("empty display name: 400 validation error", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  it("extra fields in body are ignored (only displayName changes)", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Slice Test Org", slug: "should-be-ignored" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { displayName: string; slug: string };
    assert.equal(body.displayName, "Slice Test Org");
    // slug should remain unchanged (fixture-org)
    assert.equal(body.slug, "fixture-org");

    // Restore original display name
    const restore = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Fixture Organisation" }),
    });
    assert.equal(restore.status, 200);
  });
});
