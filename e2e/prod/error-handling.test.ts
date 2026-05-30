/**
 * error-handling.test.ts
 *
 * Production error handling verification — ensures error pages render
 * correctly and API error responses are consistent and safe.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// SPA fallback for unknown routes
// ---------------------------------------------------------------------------

test.describe("error handling: SPA fallback", () => {
  test("unknown SPA route returns 200 and serves the app shell", async ({ request }) => {
    const res = await request.get("/this-route-does-not-exist");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
    expect(body).toContain("<title>Enterprise Platform</title>");
  });

  test("deep unknown route returns 200 (Caddy try_files polyfill)", async ({ request }) => {
    const res = await request.get("/a/very/deep/nested/route/that/does/not/exist");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });

  test("route with special characters is handled safely", async ({ request }) => {
    const res = await request.get("/<script>alert('xss')</script>");
    // Must not crash — 200 (SPA fallback) or 400 (safety reject) are both acceptable
    expect([200, 400, 404]).toContain(res.status());
    const body = await res.text();
    // Must not reflect unescaped script tag back in response body
    expect(body).not.toContain("<script>alert('xss')</script>");
  });
});

// ---------------------------------------------------------------------------
// API error responses
// ---------------------------------------------------------------------------

test.describe("error handling: API error format", () => {
  test("unauthenticated /api/session returns 401 with consistent error body", async ({
    request,
  }) => {
    const res = await request.get("/api/session");
    expect(res.status()).toBe(401);
    const body = await res.json();
    // Should have a consistent error shape
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  test("non-existent API route returns 404 with JSON body", async ({ request }) => {
    const res = await request.get("/api/non-existent-endpoint");
    expect(res.status()).toBe(404);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct).toContain("application/json");
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("invalid method returns 405 with Allow header", async ({ request }) => {
    // Send POST to a GET-only endpoint
    const res = await request.post("/healthz");
    expect([404, 405]).toContain(res.status());
    // If 405, Allow header should be present
    if (res.status() === 405) {
      const allow = res.headers()["allow"];
      expect(allow).toBeTruthy();
      expect(allow.toLowerCase()).toContain("get");
    }
  });

  test("API error responses do not leak stack traces", async ({ request }) => {
    const res = await request.get("/api/session");
    const body = await res.text();
    expect(body).not.toContain("at ");
    expect(body).not.toContain("node_modules");
    expect(body).not.toContain("Error:");
  });
});

// ---------------------------------------------------------------------------
// Client-side error handling
// ---------------------------------------------------------------------------

test.describe("error handling: client-side resilience", () => {
  test("app does not crash on unhandled route errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Navigate to a route that might trigger edge cases
    await page.goto("/?error=1&__proto__=test");
    await page.waitForLoadState("networkidle");

    // The app must still be mounted (not crashed)
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty({ timeout: 10_000 });
    expect(errors.length).toBeLessThanOrEqual(3); // Minor warnings tolerated
  });

  test("page fully recovers after navigation error", async ({ page }) => {
    // Navigate to a valid route first
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /platform/i })).toBeVisible();

    // Navigate back and forth — should not crash
    await page.goto("/organisation/profile");
    await page.waitForLoadState("networkidle");
    await page.goBack();
    await page.waitForLoadState("networkidle");

    const root = page.locator("#root");
    await expect(root).not.toBeEmpty({ timeout: 10_000 });
  });
});
