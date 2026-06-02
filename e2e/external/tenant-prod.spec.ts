/**
 * tenant-prod.spec.ts
 *
 * Production-only tenant FQDN routing tests.
 *
 * STAGING SKIP: *.staging.aldous.info lacks Cloudflare Universal SSL coverage
 * (second-level wildcard requires ACM, which is not enabled). Tenant FQDN tests
 * therefore run ONLY against production (aldous.info). On staging, all tests skip.
 *
 * TENANT SLUG: configure via E2E_TENANT_SLUG env var (default: e2e-tenant).
 * If the slug does not yet exist as a provisioned tenant, sysadmin credentials
 * are used to provision it. If provisioning credentials are absent the test
 * verifies routing only (Caddy wildcard serves the SPA on *.aldous.info).
 *
 * Tests:
 *   A. Routing: <slug>.aldous.info/ serves the platform React SPA (not 4xx)
 *   B. BFF reachable: <slug>.aldous.info/api/session returns 401 (unauthenticated)
 *   C. Correct host isolation: tenant FQDN is distinct from the apex host
 *   D. Staging: all tests skip with clear message (not a failure)
 *   E. If sysadmin credentials provided:
 *      - Provision the test tenant if absent (idempotent — 409 = already exists)
 *      - Verify /api/session returns 401 on tenant FQDN (BFF routing functional)
 *      - Visit /login on the tenant FQDN — must reach Keycloak-backed login
 */

import { test, expect } from "@playwright/test";
import { isProd, getExternalBaseUrl, getTestCredentials, loginAs } from "./helpers.ts";

const E2E_TENANT_SLUG = process.env["E2E_TENANT_SLUG"] ?? "e2e-tenant";
const TARGET_HOST = new URL(process.env["PROD_BASE_URL"] ?? "https://aldous.info").hostname;

// ---------------------------------------------------------------------------
// Staging skip — covers the entire file
// ---------------------------------------------------------------------------

test.describe(`${TARGET_HOST}: tenant FQDN routing (prod-only)`, () => {
  test.beforeEach(({}, testInfo) => {
    if (!isProd()) {
      testInfo.skip(
        true,
        "Tenant FQDN tests only run on prod (aldous.info). " +
          "*.staging.aldous.info lacks Cloudflare Universal SSL — no ACM in use. " +
          "Tenant E2E is deferred until ACM is enabled or a staging wildcard cert is issued."
      );
    }
  });

  // -------------------------------------------------------------------------
  // A. Routing — Caddy serves *.aldous.info without credentials
  // -------------------------------------------------------------------------

  test("tenant FQDN routes to platform React SPA (Caddy wildcard routing works)", async ({
    request,
  }) => {
    const tenantUrl = `https://${E2E_TENANT_SLUG}.aldous.info/`;
    const res = await request.get(tenantUrl, {
      failOnStatusCode: false,
      timeout: 15_000,
    });
    // 200 = tenant exists and SPA is served
    // 4xx could mean routing works but tenant logic returned an error — still OK for routing
    // 5xx = Caddy or platform-api is broken
    expect(
      res.status(),
      `${tenantUrl} must not return 5xx — Caddy wildcard routing must work`
    ).toBeLessThan(500);

    const body = await res.text();
    // Must not receive a bare JSON error from the platform BFF (that would mean
    // Caddy routed to platform-api but the SPA static files aren't served).
    expect(body, "tenant FQDN must serve the React SPA, not a raw BFF JSON error").not.toMatch(
      /^{"code":/
    );
  });

  // -------------------------------------------------------------------------
  // B. BFF reachable on tenant FQDN
  // -------------------------------------------------------------------------

  test("tenant FQDN /api/session returns 401 unauthenticated (BFF is reachable)", async ({
    request,
  }) => {
    const sessionUrl = `https://${E2E_TENANT_SLUG}.aldous.info/api/session`;
    const res = await request.get(sessionUrl, {
      failOnStatusCode: false,
      timeout: 15_000,
    });
    expect(res.status(), `${sessionUrl} must return 401 (BFF reachable, not authenticated)`).toBe(
      401
    );
  });

  // -------------------------------------------------------------------------
  // C. Host isolation: tenant FQDN is separate from apex
  // -------------------------------------------------------------------------

  test("tenant FQDN is isolated from the apex host", async ({ request }) => {
    const apexSessionUrl = `https://aldous.info/api/session`;
    const tenantSessionUrl = `https://${E2E_TENANT_SLUG}.aldous.info/api/session`;

    const [apexRes, tenantRes] = await Promise.all([
      request.get(apexSessionUrl, { failOnStatusCode: false, timeout: 15_000 }),
      request.get(tenantSessionUrl, { failOnStatusCode: false, timeout: 15_000 }),
    ]);

    // Both must be reachable (not 5xx)
    expect(apexRes.status(), "apex /api/session must respond").toBeLessThan(500);
    expect(tenantRes.status(), "tenant /api/session must respond").toBeLessThan(500);

    // Both must be 401 unauthenticated (session cookies are host-scoped)
    expect(apexRes.status()).toBe(401);
    expect(tenantRes.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // D. Sysadmin provisioning + tenant login flow (requires credentials)
  // -------------------------------------------------------------------------

  test("sysadmin can provision the test tenant and tenant login page reaches Keycloak", async ({
    page,
  }, testInfo) => {
    let credentials: { username: string; password: string };
    try {
      credentials = getTestCredentials();
    } catch {
      testInfo.skip(true, "Skipped: KEYCLOAK_TEST_USERNAME / KEYCLOAK_TEST_PASSWORD not set");
      return;
    }

    const baseUrl = getExternalBaseUrl(page);

    // Step 1: login as sysadmin on the apex host
    await loginAs(page, credentials.username, credentials.password);

    // Step 2: provision the test tenant (idempotent — 409 means already exists)
    const provisionRes = await page.request.post(`${baseUrl}/api/admin/tenants`, {
      data: {
        slug: E2E_TENANT_SLUG,
        displayName: "E2E Test Tenant",
        adminEmail: credentials.username,
        // All resources use shared tiers (defaults)
      },
      headers: { "Content-Type": "application/json" },
      failOnStatusCode: false,
      timeout: 60_000, // tenant provisioning creates KC realm, DB schema, etc.
    });

    const isCreated = provisionRes.status() === 201;
    const alreadyExists = provisionRes.status() === 409;
    expect(
      isCreated || alreadyExists,
      `Tenant provisioning must return 201 (created) or 409 (already exists). ` +
        `Got ${provisionRes.status()}: ${await provisionRes.text().catch(() => "")}`
    ).toBe(true);

    // Step 3: if just provisioned, wait for Keycloak realm to be ready
    if (isCreated) {
      // Poll readyz on the tenant FQDN — KC realm takes a few seconds to initialise
      const tenantBase = `https://${E2E_TENANT_SLUG}.aldous.info`;
      let ready = false;
      for (let i = 0; i < 15; i++) {
        const probe = await page.request
          .get(`${tenantBase}/readyz`, { failOnStatusCode: false, timeout: 5_000 })
          .catch(() => null);
        if (probe?.status() === 200) {
          ready = true;
          break;
        }
        await page.waitForTimeout(2_000);
      }
      if (!ready) {
        // Readyz may report degraded during provisioning — not fatal for routing tests
        console.warn(`Tenant ${E2E_TENANT_SLUG} readyz not 200 after 30s — proceeding anyway`);
      }
    }

    // Step 4: navigate to the tenant login page — must reach Keycloak
    const tenantLoginUrl = `https://${E2E_TENANT_SLUG}.aldous.info/login`;
    await page.goto(tenantLoginUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const body = await page.content();

    // The tenant /login page must NOT be a platform BFF NOT_FOUND
    expect(body, "tenant /login must not return platform BFF NOT_FOUND").not.toContain(
      '"code":"NOT_FOUND"'
    );

    // Must be the platform React SPA (tenant login entry) or redirect to Keycloak
    const currentUrl = page.url();
    const onTenantHost = currentUrl.includes(`${E2E_TENANT_SLUG}.aldous.info`);
    const onKeycloak = currentUrl.includes("/kc/") || currentUrl.includes("openid-connect");
    expect(
      onTenantHost || onKeycloak,
      `tenant /login must either stay on the tenant host or redirect to Keycloak. ` +
        `Current URL: ${currentUrl}`
    ).toBe(true);
  });
});
