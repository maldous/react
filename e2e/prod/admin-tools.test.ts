/**
 * admin-tools.test.ts
 *
 * Production admin tool route verification.
 *
 * Ensures:
 * 1. All admin tool routes are sysadmin-only — unauthenticated requests return 401.
 * 2. After system-admin login, tool routes return appropriate content (not SPA HTML,
 *    not 5xx errors). Skipped gracefully when KEYCLOAK_TEST credentials are absent.
 *
 * References: ADR-0029 (FQDN routing), ADR-0030 (forward_auth), ADR-0031 (privilege model)
 */

import { test, expect } from "@playwright/test";
import { loginAs, getTestCredentials } from "../external/helpers.ts";

// Admin tool routes proxied through Caddy forward_auth (resource → Caddy path)
const ADMIN_TOOLS = [
  { path: "/kc/", label: "Keycloak", resource: "admin:keycloak" },
  { path: "/mailpit/", label: "Mailpit", resource: "admin:mailpit" },
  { path: "/minio/", label: "MinIO console", resource: "admin:minio" },
  { path: "/clickhouse/", label: "ClickHouse", resource: "admin:clickhouse" },
  { path: "/pgadmin/", label: "pgAdmin", resource: "admin:pgadmin" },
];

// ---------------------------------------------------------------------------
// Unauthenticated access — all routes must deny with 401 (no session) or 403
// ---------------------------------------------------------------------------

test.describe("admin tools: unauthenticated denial", () => {
  for (const tool of ADMIN_TOOLS) {
    test(`${tool.label} (${tool.path}) rejects unauthenticated requests`, async ({ request }) => {
      const res = await request.get(tool.path, { maxRedirects: 0, failOnStatusCode: false });
      const denied = res.status() === 401 || res.status() === 403;
      expect(denied, `${tool.label} must deny unauthenticated — got ${res.status()}`).toBe(true);
      // Response must be platform-api JSON (code/message shape), not SPA HTML
      const ct = res.headers()["content-type"] ?? "";
      expect(ct).toContain("application/json");
    });
  }
});

// ---------------------------------------------------------------------------
// Authenticated system-admin access — forward_auth must allow; service must load
// ---------------------------------------------------------------------------

test.describe("admin tools: system-admin access", () => {
  test.beforeEach(({}, testInfo) => {
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
    }
  });

  for (const tool of ADMIN_TOOLS) {
    test(`${tool.label} (${tool.path}) allows system-admin and loads service UI`, async ({
      page,
    }, testInfo) => {
      const { username, password } = getTestCredentials();
      await loginAs(page, username, password);

      // Verify session has system-admin role — skip if the test user is not a system-admin
      const sessionRes = await page.request.get("/api/session");
      const session = (await sessionRes.json()) as { roles?: string[] };
      if (!session.roles?.includes("system-admin")) {
        testInfo.skip(
          true,
          "Test user lacks system-admin role — service access tests require system-admin"
        );
      }

      // Navigate to the admin tool
      const response = await page.goto(tool.path);
      const status = response?.status() ?? 0;

      // Must not be denied by forward_auth
      expect(status, `${tool.label} must not return 401/403 for system-admin`).not.toBe(401);
      expect(status, `${tool.label} must not return 401/403 for system-admin`).not.toBe(403);

      // Must not be a hard gateway error
      expect(status, `${tool.label} must not return 5xx`).toBeLessThan(500);

      // Page must load actual service content — not the React SPA
      // SPA indicates the service response was hijacked by try_files
      const body = await response?.text();
      if (body) {
        expect(body, `${tool.label} must not serve React SPA instead of service UI`).not.toContain(
          '<div id="root">'
        );
      }
    });
  }
});
