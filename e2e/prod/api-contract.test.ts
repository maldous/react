/**
 * api-contract.test.ts
 *
 * Production API contract verification — ensures consistent response format,
 * metadata, and boundary behaviour.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Metadata endpoints
// ---------------------------------------------------------------------------

test.describe("API contract: metadata endpoints", () => {
  test('GET /healthz returns { status: "ok" } with correct shape', async ({ request }) => {
    const res = await request.get("/healthz");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  test("GET /readyz returns database dependency status", async ({ request }) => {
    const res = await request.get("/readyz");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ready" });
    expect(body.dependencies).toBeTruthy();
    expect(body.dependencies.database).toBe("ok");
  });

  test("GET /version returns version metadata", async ({ request }) => {
    const res = await request.get("/version");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.environment).toBe("string");
    expect(body.environment).toMatch(/dev|test|staging|prod|development|production/i);
    expect(typeof body.buildTime).toBe("string");
    expect(typeof body.commit).toBe("string");
    expect(body.commit.length).toBeGreaterThanOrEqual(7); // git SHA
  });
});

// ---------------------------------------------------------------------------
// Session boundary
// ---------------------------------------------------------------------------

test.describe("API contract: session boundary", () => {
  test("unauthenticated /api/session returns 401", async ({ request }) => {
    const res = await request.get("/api/session");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated /api/session returns error body", async ({ request }) => {
    const res = await request.get("/api/session");
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
    // Must not leak userId or roles
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("roles");
    expect(body).not.toHaveProperty("actorId");
  });

  test("session endpoint does not expose tokens in any form", async ({ request }) => {
    const res = await request.get("/api/session");
    const body = await res.text();
    const tokenPatterns = [
      "accessToken",
      "access_token",
      "refreshToken",
      "refresh_token",
      "idToken",
      "id_token",
      "bearer",
      "Bearer",
      "jwt",
      "JWT",
      "oauth",
      "OAuth",
    ];
    for (const pattern of tokenPatterns) {
      expect(body.toLowerCase()).not.toContain(pattern.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// Response format consistency
// ---------------------------------------------------------------------------

test.describe("API contract: response consistency", () => {
  test("every API response has X-Request-Id header", async ({ request }) => {
    const endpoints = ["/healthz", "/readyz", "/version", "/api/session"];
    for (const ep of endpoints) {
      const res = await request.get(ep);
      expect(res.headers()["x-request-id"], `${ep} must include X-Request-Id`).toBeTruthy();
    }
  });

  test("every API response has Content-Type: application/json", async ({ request }) => {
    const endpoints = ["/healthz", "/readyz", "/version", "/api/session"];
    for (const ep of endpoints) {
      const res = await request.get(ep);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct, `${ep} must have Content-Type: application/json`).toContain("application/json");
    }
  });

  test("error responses use consistent error shape", async ({ request }) => {
    // Test with an invalid route to trigger 404
    const res = await request.get("/api/does-not-exist-12345");
    const body = await res.json();
    expect(body).toHaveProperty("error");
    // error must be a string or object, not an array or number
    expect(["string", "object"]).toContain(typeof body.error);
    expect(Array.isArray(body.error)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auth boundary endpoints
// ---------------------------------------------------------------------------

test.describe("API contract: auth boundary", () => {
  const SPA_PROTECTED_ROUTES = ["/organisation/profile"];

  for (const route of SPA_PROTECTED_ROUTES) {
    test(`unauthenticated request to ${route} returns 401`, async ({ request }) => {
      const res = await request.get(route, { maxRedirects: 0, failOnStatusCode: false });
      // Should be 401 (or redirect to login, which we accept as 30x)
      const accepted = res.status() === 401 || (res.status() >= 300 && res.status() < 400);
      expect(accepted, `${route} should deny unauthenticated — got ${res.status()}`).toBe(true);
    });
  }

  // Logout endpoint
  test("POST /auth/logout without session returns success or redirect", async ({ request }) => {
    const res = await request.post("/auth/logout", { maxRedirects: 0, failOnStatusCode: false });
    // Accept 200, 204, 302 (redirect) as valid logout behaviour
    expect([200, 204, 302]).toContain(res.status());
  });

  // Auth callback must be POST-only
  test("GET /auth/callback returns 404 or 405", async ({ request }) => {
    const res = await request.get("/auth/callback", { maxRedirects: 0, failOnStatusCode: false });
    expect([404, 405]).toContain(res.status());
  });
});
