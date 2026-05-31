/**
 * tool-services.spec.ts
 *
 * Real-auth E2E tests verifying admin tool services load after sysadmin login.
 * Skipped when KEYCLOAK_TEST credentials are absent.
 */
import { test, expect } from "@playwright/test";
import { loginAs, getTestCredentials, getExternalBaseUrl } from "./helpers.ts";

const TARGET_HOST = new URL(process.env["PROD_BASE_URL"] || "http://aldous.info").hostname;

const TOOLS = [
  {
    path: "/kc/",
    label: "Keycloak",
    // Keycloak admin redirects to its own OIDC login — check it gets past forward_auth
    expectTitle: /Keycloak|Sign in/i,
    expectNoSpa: true,
  },
  {
    path: "/mailpit/",
    label: "Mailpit",
    expectTitle: /Mailpit/i,
    expectNoSpa: true,
  },
  {
    path: "/minio/",
    label: "MinIO",
    expectTitle: /MinIO/i,
    expectNoSpa: true,
  },
  {
    path: "/clickhouse/play",
    label: "ClickHouse",
    // ClickHouse play UI — check it doesn't return plain "Ok"
    expectBodyNot: /^Ok$/,
    expectNoSpa: true,
  },
];

// Unauthenticated denial — always runs, no credentials needed
test.describe(`${TARGET_HOST}: admin tool routes deny unauthenticated`, () => {
  for (const tool of TOOLS) {
    test(`${tool.label} (${tool.path}) returns 401 unauthenticated`, async ({ request }) => {
      const base = process.env["PROD_BASE_URL"] || "http://aldous.info";
      const res = await request.get(new URL(tool.path, base).toString(), {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(res.status(), `${tool.label} must deny unauthenticated`).toBe(401);
      // Must return platform-api JSON error, not SPA HTML
      const ct = res.headers()["content-type"] ?? "";
      expect(ct).toContain("application/json");
    });
  }
});

// Authenticated access — skipped when KEYCLOAK_TEST credentials are absent
test.describe(`${TARGET_HOST}: admin tool services load after sysadmin login`, () => {
  test.beforeEach(({}, testInfo) => {
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
    }
  });

  for (const tool of TOOLS) {
    test(`${tool.label} (${tool.path}) loads after sysadmin login`, async ({ page }, testInfo) => {
      const { username, password } = getTestCredentials();
      await loginAs(page, username, password);

      // Skip if the logged-in user is not system-admin
      const sessionRes = await page.request.get(
        new URL("/api/session", getExternalBaseUrl(page)).toString()
      );
      const session = (await sessionRes.json()) as { roles?: string[] };
      if (!session.roles?.includes("system-admin")) {
        testInfo.skip(true, "Test user lacks system-admin role");
      }

      const response = await page.goto(new URL(tool.path, getExternalBaseUrl(page)).toString(), {
        waitUntil: "domcontentloaded",
      });

      const status = response?.status() ?? 0;
      expect(status, `${tool.label}: forward_auth must allow sysadmin`).not.toBe(401);
      expect(status, `${tool.label}: forward_auth must allow sysadmin`).not.toBe(403);
      expect(status, `${tool.label}: must not be 5xx gateway error`).toBeLessThan(500);

      const body = await response?.text();
      if (body && tool.expectNoSpa) {
        // Check for the platform SPA's unique title — not <div id="root"> since
        // MinIO Console is also a React app and uses the same div name.
        expect(
          body,
          `${tool.label}: Caddy must not serve platform SPA — indicates broken asset routing`
        ).not.toContain("<title>Enterprise Platform</title>");
      }
      if (body && tool.expectBodyNot) {
        expect(body.trim(), `${tool.label}: must serve UI not bare health response`).not.toMatch(
          tool.expectBodyNot
        );
      }
      if (tool.expectTitle) {
        await expect(page).toHaveTitle(tool.expectTitle, { timeout: 15_000 });
      }
    });
  }
});
