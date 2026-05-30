/**
 * aldous-caddy-links.spec.ts
 *
 * Caddy forward_auth protection tests — http://aldous.info
 *
 * Tests that protected admin tool routes:
 * - deny unauthenticated access (401 or redirect to login)
 * - allow authenticated system-admin access
 *
 * Note: this tests ROUTE ACCESS BEHAVIOUR only — not that every backend
 * service is fully operational. Profile-gated services may return 502 even
 * when the route allows the request through.
 */
import { test, expect } from "@playwright/test";
import { getExternalBaseUrl, getTestCredentials, loginAs } from "./helpers.ts";

const TARGET_HOST = new URL(process.env["PROD_BASE_URL"] || "http://aldous.info").hostname;

/** Admin routes protected by forward_auth in Caddyfile */
const PROTECTED_ROUTES = [
  { path: "/kc/", label: "Keycloak", resource: "admin:keycloak" },
  { path: "/mailpit/", label: "Mailpit", resource: "admin:mailpit" },
  { path: "/minio/", label: "MinIO", resource: "admin:minio" },
  { path: "/sonar/", label: "SonarQube", resource: "admin:sonarqube" },
  { path: "/wiremock/", label: "WireMock", resource: "admin:wiremock" },
  { path: "/clickhouse/", label: "ClickHouse", resource: "admin:clickhouse" },
];

test.describe(`${TARGET_HOST}: Caddy forward_auth — unauthenticated denial`, () => {
  for (const route of PROTECTED_ROUTES) {
    test(`unauthenticated request to ${route.path} is denied (401/403/redirect)`, async ({
      request,
    }) => {
      // Direct HTTP request with no session cookie
      const res = await request.get(new URL(route.path, getExternalBaseUrl()).toString(), {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      // Caddy forward_auth returns 401 when Caddy enforces it, or 302 to login
      // Accept any denial code: 401, 403, or redirect (30x) away from the tool
      const denied =
        res.status() === 401 || res.status() === 403 || (res.status() >= 300 && res.status() < 400);
      expect(
        denied,
        `${route.label} (${route.path}) must deny unauthenticated access — got ${res.status()}`
      ).toBe(true);
    });
  }
});

test.describe(`${TARGET_HOST}: Caddy forward_auth — authenticated system-admin access`, () => {
  test.beforeEach(({}, testInfo) => {
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
    }
  });

  for (const route of PROTECTED_ROUTES) {
    test(`authenticated system-admin can access ${route.path} (forward_auth allows)`, async ({
      page,
    }) => {
      const { username, password } = getTestCredentials();
      await loginAs(page, username, password);

      // Navigate to the tool route — Caddy forward_auth must allow it
      const response = await page.goto(new URL(route.path, getExternalBaseUrl(page)).toString());
      // Accept: 200 (service running), 502/503 (service not running but auth passed),
      // or 30x (service redirects internally). Reject: 401, 403 (auth denied).
      const status = response?.status() ?? 0;
      const authPassed = status !== 401 && status !== 403;
      expect(
        authPassed,
        `${route.label} (${route.path}) forward_auth must allow system-admin — got ${status}`
      ).toBe(true);
    });
  }
});
