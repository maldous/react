/**
 * security-headers.test.ts
 *
 * Production security header verification — every response must carry the
 * correct security headers. Missing or misconfigured headers are a compliance
 * and operational risk.
 *
 * References:
 *   - OWASP Secure Headers Project
 *   - MDN Web Security
 *   - ADR-0022 (token boundary)
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// SPA — index and deep routes
// ---------------------------------------------------------------------------

test.describe("security: SPA response headers", () => {
  const SPA_ROUTES = ["/", "/organisation/profile", "/auth/login"];

  for (const route of SPA_ROUTES) {
    test(`SPA route ${route} sets X-Content-Type-Options: nosniff`, async ({ request }) => {
      const res = await request.get(route);
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    });

    test(`SPA route ${route} sets X-Frame-Options: DENY`, async ({ request }) => {
      const res = await request.get(route);
      expect(res.headers()["x-frame-options"]).toBe("DENY");
    });

    test(`SPA route ${route} sets Referrer-Policy`, async ({ request }) => {
      const res = await request.get(route);
      const policy = res.headers()["referrer-policy"];
      expect(policy).toBeTruthy();
      // Must be one of the strict policies
      expect(["strict-origin-when-cross-origin", "same-origin", "no-referrer"]).toContain(policy);
    });

    test(`SPA route ${route} sets Permissions-Policy`, async ({ request }) => {
      const res = await request.get(route);
      const policy = res.headers()["permissions-policy"];
      expect(policy).toBeTruthy();
      // Must not grant dangerous permissions broadly
      expect(policy).not.toContain("geolocation=*");
      expect(policy).not.toContain("camera=*");
      expect(policy).not.toContain("microphone=*");
    });

    test(`SPA route ${route} sets Content-Security-Policy`, async ({ request }) => {
      const res = await request.get(route);
      const csp = res.headers()["content-security-policy"];
      expect(csp, `CSP must be set on ${route}`).toBeTruthy();
      // CSP must not allow unsafe-inline for scripts
      expect(csp).not.toContain("script-src 'unsafe-inline'");
      // CSP must restrict frame ancestors
      expect(csp).toContain("frame-ancestors");
    });

    test(`SPA route ${route} sets Cache-Control for dynamic content`, async ({ request }) => {
      const res = await request.get(route);
      const cacheControl = res.headers()["cache-control"];
      expect(cacheControl).toBeTruthy();
      // Dynamic HTML must not be cached aggressively
      expect(cacheControl).toMatch(/no-cache|no-store|private/);
    });
  }
});

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

test.describe("security: API response headers", () => {
  const API_ROUTES = ["/healthz", "/readyz", "/version", "/api/session"];

  for (const route of API_ROUTES) {
    test(`API route ${route} sets X-Content-Type-Options: nosniff`, async ({ request }) => {
      const res = await request.get(route);
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    });

    test(`API route ${route} does not expose Server header`, async ({ request }) => {
      const res = await request.get(route);
      const server = res.headers()["server"];
      // Either absent or doesn't leak version info
      if (server) {
        expect(server).not.toMatch(/\/[\d.]+/); // No version in server header
        expect(server.toLowerCase()).not.toContain("express");
        expect(server.toLowerCase()).not.toContain("node");
      }
    });

    test(`API route ${route} sets Cache-Control: no-cache`, async ({ request }) => {
      const res = await request.get(route);
      expect(res.headers()["cache-control"]).toMatch(/no-cache|no-store/);
    });
  }

  // CORS — API must NOT be accessed cross-origin from uncontrolled origins
  test("API does not expose permissive Access-Control-Allow-Origin", async ({ request }) => {
    // Even without an Origin header, no wildcard CORS should be set
    const res = await request.get("/healthz");
    const acao = res.headers()["access-control-allow-origin"];
    if (acao) {
      expect(acao).not.toBe("*");
    }
  });

  // Content-Type must be correct for JSON endpoints
  test("API JSON responses have correct Content-Type", async ({ request }) => {
    const res = await request.get("/healthz");
    const ct = res.headers()["content-type"] ?? "";
    expect(ct).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// Static assets — must have immutable caching headers
// ---------------------------------------------------------------------------

test.describe("security: static asset headers", () => {
  test("JS bundles set immutable Cache-Control with content hash", async ({ page }) => {
    // Collect asset response headers as they load
    const assetHeaders: Array<{ url: string; cacheControl: string }> = [];
    page.on("response", (res) => {
      const url = res.url();
      if (res.status() === 200 && url.includes("/assets/") && url.endsWith(".js")) {
        assetHeaders.push({ url, cacheControl: res.headers()["cache-control"] ?? "" });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("load");

    for (const asset of assetHeaders) {
      expect(asset.cacheControl, `Asset ${asset.url} must have immutable cache control`).toMatch(
        /immutable|max-age=\d{7,}/
      );
    }
    // At least one JS bundle was loaded
    expect(assetHeaders.length).toBeGreaterThan(0);
  });

  test("CSS bundles set immutable Cache-Control with content hash", async ({ page }) => {
    const assetHeaders: Array<{ url: string; cacheControl: string }> = [];
    page.on("response", (res) => {
      const url = res.url();
      if (res.status() === 200 && url.includes("/assets/") && url.endsWith(".css")) {
        assetHeaders.push({ url, cacheControl: res.headers()["cache-control"] ?? "" });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("load");

    for (const asset of assetHeaders) {
      expect(asset.cacheControl, `Asset ${asset.url} must have immutable cache control`).toMatch(
        /immutable|max-age=\d{7,}/
      );
    }
  });
});
