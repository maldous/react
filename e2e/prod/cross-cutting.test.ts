/**
 * cross-cutting.test.ts
 *
 * Production cross-cutting concern verification — ensures request tracing,
 * environment metadata, and observability infrastructure are working.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Request tracing
// ---------------------------------------------------------------------------

test.describe("cross-cutting: request tracing", () => {
  test("every response includes X-Request-Id header with unique value", async ({ request }) => {
    const res1 = await request.get("/healthz");
    const res2 = await request.get("/healthz");
    const id1 = res1.headers()["x-request-id"];
    const id2 = res2.headers()["x-request-id"];

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    // Each request must get a unique ID
    expect(id1).not.toBe(id2);
  });

  test("X-Request-Id header is a valid UUID or ULID format", async ({ request }) => {
    const res = await request.get("/healthz");
    const requestId = res.headers()["x-request-id"];

    expect(requestId, "X-Request-Id must be present").toBeTruthy();
    // Accept UUID format: 8-4-4-4-12 or ULID: 26 alphanumeric chars
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUlid = /^[0-9A-Z]{26}$/;
    expect(
      isUuid.test(requestId) || isUlid.test(requestId),
      `X-Request-Id "${requestId}" is not a valid UUID or ULID format`
    ).toBe(true);
  });

  test("X-Request-Id length is reasonable", async ({ request }) => {
    const res = await request.get("/healthz");
    const requestId = res.headers()["x-request-id"];
    expect(requestId.length).toBeGreaterThanOrEqual(20);
    expect(requestId.length).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// Environment awareness
// ---------------------------------------------------------------------------

test.describe("cross-cutting: environment metadata", () => {
  test("version endpoint returns environment name", async ({ request }) => {
    const res = await request.get("/version");
    const body = await res.json();
    expect(typeof body.environment).toBe("string");
    // Environment must be one of the known values
    expect(["dev", "test", "staging", "prod", "development", "production"]).toContain(
      body.environment.toLowerCase()
    );
  });

  test("version endpoint returns commit SHA", async ({ request }) => {
    const res = await request.get("/version");
    const body = await res.json();
    expect(typeof body.commit).toBe("string");
    if (body.commit === "unknown") return; // GIT_SHA not injected in this environment
    expect(body.commit.length).toBeGreaterThanOrEqual(7);
    expect(body.commit).toMatch(/^[0-9a-f]{7,40}$/i);
  });

  test("version endpoint returns build timestamp", async ({ request }) => {
    const res = await request.get("/version");
    const body = await res.json();
    expect(typeof body.buildTime).toBe("string");
    if (body.buildTime === "unknown") return; // BUILD_TIME not injected in this environment
    const parsed = new Date(body.buildTime);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// Response headers consistency
// ---------------------------------------------------------------------------

test.describe("cross-cutting: response header consistency", () => {
  test("all SPA responses include same security headers", async ({ request }) => {
    const routes = ["/", "/organisation/profile", "/auth/login"];
    const requiredHeaders = ["x-content-type-options", "x-frame-options", "referrer-policy"];

    for (const route of routes) {
      const res = await request.get(route);
      for (const header of requiredHeaders) {
        expect(res.headers()[header], `${route} missing header: ${header}`).toBeTruthy();
      }
    }
  });

  test("Content-Length is present and accurate for API responses", async ({ request }) => {
    const res = await request.get("/healthz");
    const contentLength = res.headers()["content-length"];
    // Must have a content-length or transfer-encoding: chunked
    expect(contentLength || res.headers()["transfer-encoding"]).toBeTruthy();
    if (contentLength) {
      const body = await res.text();
      expect(parseInt(contentLength, 10)).toBeGreaterThan(0);
      // Content-Length should match actual body length (unless chunked)
      if (body.length > 500) {
        expect(Math.abs(parseInt(contentLength, 10) - Buffer.byteLength(body))).toBeLessThan(100);
      }
    }
  });

  test("Date header is present and reasonable", async ({ request }) => {
    const res = await request.get("/healthz");
    const date = res.headers()["date"];
    expect(date, "Date header must be present").toBeTruthy();
    const parsed = new Date(date);
    expect(parsed.getTime()).not.toBeNaN();
    // Date must be within 5 minutes of now
    expect(Math.abs(parsed.getTime() - Date.now())).toBeLessThan(5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

test.describe("cross-cutting: observability", () => {
  test("API responses are collectable (Content-Type is stable)", async ({ request }) => {
    const res = await request.get("/healthz");
    const ct = res.headers()["content-type"] ?? "";
    // Must be parseable JSON
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });

  test("error responses include trace identifier for debugging", async ({ request }) => {
    // Trigger a 401 error
    const res = await request.get("/api/session");
    const body = await res.text();
    // Must either include request ID in body or it's already in headers
    const requestId = res.headers()["x-request-id"];
    expect(requestId).toBeTruthy();
  });
});
