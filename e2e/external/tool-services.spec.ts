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
import { loginAs, getTestCredentials, getExternalBaseUrl } from "./helpers.ts";

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
  {
    path: "/sentry/",
    label: "Sentry",
    expectTitle: /Sentry/i,
  },
  {
    path: "/wiremock/",
    label: "WireMock",
    expectTitle: /WireMock/i,
  },
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
});
