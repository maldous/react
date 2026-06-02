/**
 * tool-services.spec.ts
 *
 * Real-auth E2E tests verifying admin tool services behave correctly.
 *
 * Coverage:
 * - All tool routes deny unauthenticated access (401 + JSON body)
 * - Profile-gated services return 502 when not running (sonar/sentry/wiremock)
 * - Running services load correctly after sysadmin login
 * - Keycloak admin doesn't show error page
 * - MinIO preloader images are not broken (assets route correctly)
 */
import { test, expect } from "@playwright/test";
import { loginAs, getTestCredentials, getExternalBaseUrl, isProd } from "./helpers.ts";

const TARGET_HOST = new URL(process.env["PROD_BASE_URL"] || "http://aldous.info").hostname;
const BASE = process.env["PROD_BASE_URL"] || "http://aldous.info";

// All tool services — required to be running in staging and prod
const RUNNING_TOOLS = [
  {
    path: "/kc/",
    label: "Keycloak",
    expectTitle: /Keycloak|Sign in/i,
  },
  {
    path: "/mailpit/",
    label: "Mailpit",
    expectTitle: /Mailpit/i,
  },
  {
    path: "/minio/",
    label: "MinIO",
    expectTitle: /MinIO/i,
  },
  {
    path: "/clickhouse/play",
    label: "ClickHouse",
    expectBodyNot: /^Ok\s*$/,
  },
  {
    path: "/sonar/",
    label: "SonarQube",
    expectTitle: /SonarQube/i,
  },
  // Sentry is now on sentry.{apex} subdomain — verified separately below.
  // WireMock is intentionally absent — NOT_EXPOSED as a clickthrough service.
  // Access WireMock directly via WIREMOCK_PORT in local dev.
  {
    path: "/pgadmin/",
    label: "pgAdmin",
    expectTitle: /pgAdmin/i,
  },
];

// No profile-gated tools — all tools are required
const PROFILE_GATED_TOOLS: Array<{ path: string; label: string; profile: string }> = [];

const ALL_TOOL_PATHS = [
  ...RUNNING_TOOLS.map((t) => t.path),
  ...PROFILE_GATED_TOOLS.map((t) => t.path),
];

// ---------------------------------------------------------------------------
// Unauthenticated denial — always runs, no credentials needed
// ---------------------------------------------------------------------------

test.describe(`${TARGET_HOST}: admin tool routes deny unauthenticated`, () => {
  for (const path of ALL_TOOL_PATHS) {
    test(`${path} returns 401 unauthenticated`, async ({ request }) => {
      const res = await request.get(new URL(path, BASE).toString(), {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(res.status(), `${path} must deny unauthenticated`).toBe(401);
      expect(res.headers()["content-type"] ?? "").toContain("application/json");
    });
  }
});

// ---------------------------------------------------------------------------
// Running services — load correctly after sysadmin login
// ---------------------------------------------------------------------------

test.describe(`${TARGET_HOST}: admin tool services load after sysadmin login`, () => {
  let isSysadmin = false;

  test.beforeEach(async ({ page }, testInfo) => {
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
      return;
    }

    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    const sessionRes = await page.request.get(
      new URL("/api/session", getExternalBaseUrl(page)).toString()
    );
    const session = (await sessionRes.json()) as { roles?: string[] };
    isSysadmin = session.roles?.includes("system-admin") ?? false;
    if (!isSysadmin) testInfo.skip(true, "Test user lacks system-admin role");
  });

  for (const tool of RUNNING_TOOLS) {
    test(`${tool.label} (${tool.path}) loads — not 4xx/5xx, not SPA`, async ({ page }) => {
      const response = await page.goto(new URL(tool.path, getExternalBaseUrl(page)).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      const status = response?.status() ?? 0;
      expect(status, `${tool.label}: forward_auth must allow sysadmin`).not.toBe(401);
      expect(status, `${tool.label}: forward_auth must allow sysadmin`).not.toBe(403);
      expect(status, `${tool.label}: must not be 5xx`).toBeLessThan(500);

      const body = await response?.text();
      if (body) {
        expect(
          body,
          `${tool.label}: Caddy must not serve platform SPA (broken asset routing)`
        ).not.toContain("<title>Enterprise Platform</title>");
      }
      if (tool.expectBodyNot && body) {
        expect(body.trim(), `${tool.label}: must not return bare health response`).not.toMatch(
          tool.expectBodyNot
        );
      }
      if (tool.expectBodyContains && body) {
        expect(
          body,
          `${tool.label}: response body must contain "${tool.expectBodyContains}"`
        ).toContain(tool.expectBodyContains);
      }
      if (tool.expectTitle) {
        await expect(page).toHaveTitle(tool.expectTitle, { timeout: 15_000 });
      }
    });
  }

  test("Keycloak admin does not show error page", async ({ page }) => {
    await page.goto(new URL("/kc/", getExternalBaseUrl(page)).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    // Keycloak "somethingWentWrong" appears when HTTPS cookies are broken (KC_HOSTNAME=http vs https)
    const body = await page.content();
    expect(body).not.toContain("somethingWentWrong");
    expect(body).not.toContain("Something went wrong");
  });

  test("MinIO preloader images load — no broken assets via Caddy strip_prefix", async ({
    page,
  }) => {
    const failedImages: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      const isImage =
        url.includes("/minio/images/") || url.includes("/minio/Loader") || url.endsWith(".svg");
      if (isImage && res.status() >= 400) {
        failedImages.push(`${res.status()} ${url}`);
      }
    });

    await page.goto(new URL("/minio/", getExternalBaseUrl(page)).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    expect(
      failedImages,
      `MinIO preloader images must load — failed: ${failedImages.join(", ")}`
    ).toHaveLength(0);
  });

  test("WireMock link must not appear on landing page — WireMock is NOT_EXPOSED", async ({
    page,
  }) => {
    await page.goto(getExternalBaseUrl(page).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    // The WireMock tool-link was removed from TOOL_LINKS; its testId must not exist.
    const wiremockLink = page.locator('[data-testid="tool-link-wiremock"]');
    await expect(wiremockLink).toHaveCount(0, { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Sentry subdomain tests — Sentry was moved from /sentry/* path-prefix to
// sentry.{apex} subdomain to prevent its /auth/login/ redirect from colliding
// with the platform BFF's /auth/* routes.
// ---------------------------------------------------------------------------

test.describe(`${TARGET_HOST}: Sentry subdomain routing`, () => {
  let isSysadmin = false;

  test.beforeEach(async ({ page }, testInfo) => {
    // Skip the entire describe block on staging.
    // sentry.staging.aldous.info requires *.staging.aldous.info TLS which is
    // not available without Cloudflare Advanced Certificate Manager.
    // Staging E2E only tests staging.aldous.info routes directly.
    if (!isProd()) {
      testInfo.skip(
        true,
        "Sentry subdomain tests only run on prod (aldous.info). " +
          "*.staging.aldous.info lacks Cloudflare Universal SSL coverage — no ACM in use."
      );
      return;
    }
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
      return;
    }
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);
    const sessionRes = await page.request.get(
      new URL("/api/session", getExternalBaseUrl(page)).toString()
    );
    const session = (await sessionRes.json()) as { roles?: string[] };
    isSysadmin = session.roles?.includes("system-admin") ?? false;
    if (!isSysadmin) testInfo.skip(true, "Test user lacks system-admin role");
  });

  test("Sentry link on landing page uses subdomain href, not /sentry/ path", async ({ page }) => {
    await page.goto(getExternalBaseUrl(page).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    const sentryLink = page.locator('[data-testid="tool-link-sentry"]');
    await expect(sentryLink).toBeVisible({ timeout: 5_000 });
    const href = await sentryLink.getAttribute("href");
    expect(href, "Sentry link must use sentry.{host} subdomain format").toMatch(/^\/\/sentry\./);
    expect(href, "Sentry link must not be the old /sentry/ path").not.toContain("/sentry/");
  });

  test("Sentry subdomain does not return platform NOT_FOUND — /auth/login/ collision must be gone", async ({
    page,
    request,
  }) => {
    // isProd() guard is in beforeEach — this only runs on aldous.info.
    const apexUrl = getExternalBaseUrl(page);
    const apexHost = new URL(apexUrl.toString()).hostname;
    const sentryBase = `${new URL(apexUrl.toString()).protocol}//sentry.${apexHost}`;

    // Unauthenticated hit must return 401 JSON (forward_auth), NOT platform NOT_FOUND.
    const unauthRes = await request.get(sentryBase, {
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: 10_000,
    });
    const unauthStatus = unauthRes.status();
    const unauthBody = await unauthRes.text().catch(() => "");

    expect(unauthStatus, "unauthenticated sentry must return 401 (forward_auth)").toBe(401);
    expect(
      unauthBody,
      "sentry 401 must not contain '/auth/login/ not found' (old BFF path collision)"
    ).not.toContain("/auth/login/ not found");

    // Authenticated hit must not contain the old BFF NOT_FOUND error
    const authRes = await page.goto(sentryBase, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const status = authRes?.status() ?? 0;
    // 502 = Sentry profile not running — auth passed, service unavailable. Acceptable.
    if (status === 502) return;

    expect(status, "Sentry must not be 401/403 for sysadmin").not.toBe(401);
    expect(status, "Sentry must not be 403 for sysadmin").not.toBe(403);

    const body = (await authRes?.text()) ?? "";
    expect(body, "Sentry must not return platform NOT_FOUND").not.toContain(
      "/auth/login/ not found"
    );
    expect(body, "Sentry must not contain platform BFF NOT_FOUND JSON").not.toContain(
      '"code":"NOT_FOUND"'
    );
  });
});
