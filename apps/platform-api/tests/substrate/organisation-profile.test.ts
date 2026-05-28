/**
 * Organisation profile endpoint tests.
 * Tests GET /api/organisation/profile and PATCH /api/organisation/profile
 * using the PRODUCTION route list from server/routes.ts and a real HTTP server + real Postgres.
 *
 * Requires: Postgres running at POSTGRES_URL (default: localhost:5433).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "../../src/server/pipeline.ts";
import { routes } from "../../src/server/routes.ts";

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

function setFixtureRole(role: string | undefined): void {
  if (role === undefined) {
    delete process.env["LOCAL_FIXTURE_SESSION"];
  } else {
    process.env["LOCAL_FIXTURE_SESSION"] = role;
  }
}

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

  it("no-membership: 403 (no organisation.read permission)", async () => {
    setFixtureRole("no-membership");
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
    assert.ok(res.headers.get("x-request-id"), "X-Request-Id should be present on error");
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
    // Restore
    const restore = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Fixture Organisation" }),
    });
    assert.equal(restore.status, 200);
  });

  it("tenant-admin: trims whitespace from display name", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "  Trimmed Name  " }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { displayName: string };
    assert.equal(body.displayName, "Trimmed Name");
    // Restore
    await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Fixture Organisation" }),
    });
  });

  it("viewer: 403 (lacks organisation.update)", async () => {
    setFixtureRole("viewer");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Should Not Update" }),
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code: string }).code, "FORBIDDEN");
  });

  it("unauthenticated: 401", async () => {
    setFixtureRole(undefined);
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Should Not Update" }),
    });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { code: string }).code, "UNAUTHORIZED");
  });

  it("no-membership: 403", async () => {
    setFixtureRole("no-membership");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Should Not Update" }),
    });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code: string }).code, "FORBIDDEN");
  });

  it("empty display name: 400 validation error", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "" }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, "VALIDATION_ERROR");
  });

  it("display name too short (1 char): 400", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "X" }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, "VALIDATION_ERROR");
  });

  it("display name too long (121 chars): 400", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "A".repeat(121) }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, "VALIDATION_ERROR");
  });

  it("extra fields in body are rejected (strict schema): 400 — slug/id/tenantId cannot be sent", async () => {
    setFixtureRole("tenant-admin");
    const res = await fetch(`${url}/api/organisation/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Should Not Apply",
        slug: "hostile",
        id: "bad",
        tenantId: "hostile-tenant",
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "VALIDATION_ERROR");

    // Confirm the underlying record is untouched.
    setFixtureRole("tenant-admin");
    const verify = await fetch(`${url}/api/organisation/profile`);
    assert.equal(verify.status, 200);
    const profile = (await verify.json()) as { id: string; slug: string; displayName: string };
    assert.equal(profile.id, "00000000-0000-0000-0000-000000000001");
    assert.equal(profile.slug, "fixture-org");
    assert.notEqual(profile.displayName, "Should Not Apply");
  });
});
