/**
 * Auth route tests: GET /auth/login, GET /auth/callback, POST /auth/logout.
 *
 * These tests use a real HTTP server (port 0) but mock Keycloak and Redis
 * via environment variables and intercepting adapter calls where needed.
 *
 * /auth/login: tests redirect URL shape and state parameter
 * /auth/callback: tests missing params, bad state, and cookie path
 * /auth/logout: tests session cookie clearing
 * /api/session: fixture-session regression (no regression from real-session path)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "../../src/server/pipeline.ts";
import { routes } from "../../src/server/routes.ts";
import { SESSION_COOKIE_NAME } from "@platform/adapters-redis";
import { connectRedis, disconnectRedis } from "../../src/server/dependencies.ts";

// Auth-route env vars — applied per describe block (not at module level) so they
// cannot mutate process.env during import and interfere with other test files that
// load concurrently in the Node.js test runner.
const AUTH_TEST_ENV: Record<string, string> = {
  KEYCLOAK_URL: "http://keycloak-test.local:8080",
  KEYCLOAK_REALM: "test-realm",
  KEYCLOAK_CLIENT_ID: "test-client",
  KEYCLOAK_CLIENT_SECRET: "test-secret",
  PLATFORM_API_URL: "http://localhost:3001",
  APP_BASE_URL: "http://localhost:5173",
};
let savedAuthEnv: Record<string, string | undefined> = {};

function applyAuthEnv() {
  for (const [k, v] of Object.entries(AUTH_TEST_ENV)) {
    savedAuthEnv[k] = process.env[k];
    process.env[k] = v;
  }
}

function restoreAuthEnv() {
  for (const k of Object.keys(AUTH_TEST_ENV)) {
    if (savedAuthEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedAuthEnv[k];
    }
  }
  savedAuthEnv = {};
}

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

// ---------------------------------------------------------------------------
// GET /auth/login ? redirect to Keycloak
// ---------------------------------------------------------------------------

describe("GET /auth/login", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    applyAuthEnv();
    delete process.env["LOCAL_FIXTURE_SESSION"];
    await connectRedis();
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
    await disconnectRedis();
    restoreAuthEnv();
  });

  it("redirects to Keycloak authorization endpoint (302)", async () => {
    const res = await fetch(`${url}/auth/login`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const location = res.headers.get("location");
    assert.ok(location, "Location header must be present");
    // The public Keycloak URL is now derived from the request Host header.
    // Test server binds to 127.0.0.1:{port} so the public URL uses that host with /kc path.
    const testHost = new URL(url).host;
    assert.ok(
      location.startsWith(`http://${testHost}/kc/realms/test-realm/protocol/openid-connect/auth`),
      `Expected Keycloak auth URL starting with http://${testHost}/kc/realms/..., got: ${location}`
    );
  });

  it("sets pre-auth nonce cookie for user-agent binding", async () => {
    const res = await fetch(`${url}/auth/login`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes("auth_state_token="), "pre-auth cookie must be set");
    assert.ok(setCookie.includes("HttpOnly"), "pre-auth cookie must be HttpOnly");
    assert.ok(
      setCookie.includes("SameSite=Lax"),
      "pre-auth cookie must be SameSite=Lax for cross-site redirect"
    );
  });

  it("includes required PKCE parameters in redirect URL", async () => {
    const res = await fetch(`${url}/auth/login`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const parsed = new URL(location);
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("client_id"), "test-client");
    assert.ok(parsed.searchParams.get("state"), "state must be present");
    assert.ok(parsed.searchParams.get("code_challenge"), "code_challenge must be present");
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.ok(parsed.searchParams.get("redirect_uri")?.includes("/auth/callback"));
  });

  it("accepts and sanitises returnTo parameter", async () => {
    const res = await fetch(`${url}/auth/login?returnTo=/organisation/profile`, {
      redirect: "manual",
    });
    assert.equal(res.status, 302);
  });

  it("rejects absolute returnTo ? falls back to /", async () => {
    const res = await fetch(`${url}/auth/login?returnTo=https://evil.example.com`, {
      redirect: "manual",
    });
    // Still redirects to Keycloak (not to the external URL)
    assert.equal(res.status, 302);
    const location = res.headers.get("location") ?? "";
    // With host-derived public URL, redirect goes to the test server's own /kc path
    const testHost = new URL(url).host;
    assert.ok(
      location.includes(`${testHost}/kc`),
      `Should redirect to ${testHost}/kc, not evil.example.com. Got: ${location}`
    );
  });
});

// ---------------------------------------------------------------------------
// GET /auth/callback ? error paths
// ---------------------------------------------------------------------------

describe("GET /auth/callback ? error paths", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    applyAuthEnv();
    delete process.env["LOCAL_FIXTURE_SESSION"];
    await connectRedis();
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
    await disconnectRedis();
    restoreAuthEnv();
  });

  // Every non-success callback bounces (302) to the app /login?authError=signin_failed
  // rather than returning a JSON error — Keycloak stays invisible (ADR-ACT-0157).
  const expectBounceToLogin = (res: Response): void => {
    assert.equal(res.status, 302);
    const loc = res.headers.get("location") ?? "";
    assert.ok(
      loc.includes("/login?authError=signin_failed"),
      `expected bounce to /login?authError=signin_failed, got ${loc}`
    );
  };

  it("bounces to /login when pre-auth cookie is missing (no user-agent binding)", async () => {
    const res = await fetch(`${url}/auth/callback?code=c&state=s`, { redirect: "manual" });
    expectBounceToLogin(res);
  });

  it("bounces to /login when code is missing", async () => {
    const res = await fetch(`${url}/auth/callback?state=abc`, {
      headers: { Cookie: "auth_state_token=nonce" },
      redirect: "manual",
    });
    expectBounceToLogin(res);
  });

  it("bounces to /login when state is missing", async () => {
    const res = await fetch(`${url}/auth/callback?code=abc`, {
      headers: { Cookie: "auth_state_token=nonce" },
      redirect: "manual",
    });
    expectBounceToLogin(res);
  });

  it("bounces to /login when state is unknown or expired", async () => {
    const res = await fetch(`${url}/auth/callback?code=c&state=nonexistent-state-xyz`, {
      headers: { Cookie: "auth_state_token=nonce" },
      redirect: "manual",
    });
    expectBounceToLogin(res);
  });

  it("bounces to /login when Keycloak reports an error", async () => {
    const res = await fetch(`${url}/auth/callback?error=access_denied&state=s`, {
      headers: { Cookie: "auth_state_token=nonce" },
      redirect: "manual",
    });
    expectBounceToLogin(res);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

describe("POST /auth/logout", () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    applyAuthEnv();
    delete process.env["LOCAL_FIXTURE_SESSION"];
    await connectRedis();
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });

  after(async () => {
    await closeServer(server);
    await disconnectRedis();
    restoreAuthEnv();
  });

  it("returns 204 even without a session cookie", async () => {
    const res = await fetch(`${url}/auth/logout`, { method: "POST" });
    assert.equal(res.status, 204);
  });

  it("clears the session cookie in the response", async () => {
    const res = await fetch(`${url}/auth/logout`, { method: "POST" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes(SESSION_COOKIE_NAME), "Must clear the session cookie");
    assert.ok(setCookie.includes("Max-Age=0"), "Max-Age=0 clears the cookie");
    assert.ok(setCookie.includes("HttpOnly"));
  });
});

// ---------------------------------------------------------------------------
// GET /api/session ? fixture regression
// ---------------------------------------------------------------------------

describe("GET /api/session ? fixture session regression", () => {
  let server: http.Server;
  let url: string;
  let savedEnv: string | undefined;

  before(async () => {
    applyAuthEnv();
    savedEnv = process.env["LOCAL_FIXTURE_SESSION"];
    const s = await makeServer();
    server = s.server;
    url = s.url;
  });

  after(async () => {
    if (savedEnv !== undefined) process.env["LOCAL_FIXTURE_SESSION"] = savedEnv;
    else delete process.env["LOCAL_FIXTURE_SESSION"];
    await closeServer(server);
    restoreAuthEnv();
  });

  it("returns fixture actor when LOCAL_FIXTURE_SESSION=tenant-admin", async () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";
    const res = await fetch(`${url}/api/session`);
    assert.equal(res.status, 200);
    const actor = (await res.json()) as { roles: string[]; permissions: string[] };
    assert.ok(actor.roles.includes("tenant-admin"));
    assert.ok(actor.permissions.includes("organisation.read"));
  });

  it("returns 401 when no fixture and no cookie", async () => {
    delete process.env["LOCAL_FIXTURE_SESSION"];
    const res = await fetch(`${url}/api/session`);
    assert.equal(res.status, 401);
  });
});
