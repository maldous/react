/**
 * aldous-login.spec.ts
 *
 * Real Keycloak browser login E2E — http://aldous.info
 *
 * Tests that the platform login flow works end-to-end:
 * browser → React login page → Caddy → /auth/login → Keycloak → callback
 * → session in Redis → HTTP-only cookie → React landing page
 *
 * Prerequisites: docs/local-development/real-login-e2e.md
 */
import { test, expect } from "@playwright/test";
import {
  getExternalBaseUrl,
  getTestCredentials,
  loginAs,
  assertSessionAuthenticated,
} from "./helpers.ts";

const TARGET_HOST = new URL(process.env["PROD_BASE_URL"] || "http://aldous.info").hostname;

test.describe(`${TARGET_HOST}: platform login`, () => {
  test.beforeEach(({}, testInfo) => {
    // Skip entire suite if env vars are not set
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
    }
  });

  test("unauthenticated visitor sees sign-in entry on homepage", async ({ page }) => {
    await page.goto(new URL("/", getExternalBaseUrl(page)).toString());
    // Either the index page shows a sign-in link, or it redirects to /auth/login
    const signinEntry = page.locator(
      '[data-testid="sign-in-link"], [data-testid="sign-in-button"], h1:has-text("Sign in")'
    );
    await expect(signinEntry.first()).toBeVisible({ timeout: 10_000 });
  });

  test("login page is themed with platform branding", async ({ page }) => {
    await page.goto(new URL("/auth/login", getExternalBaseUrl(page)).toString());
    // Platform name must appear — proves Option B theming is applied.
    // Keycloak renders "Enterprise Platform (local)" in a banner element, not h1/h2.
    await expect(
      page
        .locator("#kc-header-wrapper, header, .pf-v5-c-brand")
        .filter({
          hasText: /Enterprise Platform|Platform/i,
        })
        .first()
    ).toBeVisible();
    // Keycloak form submit button must be present (not a React testid — we are on the KC page)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("real Keycloak login succeeds and session is established", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Session actor is visible in the page header
    await expect(page.getByTestId("actor-display")).toBeVisible();

    // /api/session returns an authenticated actor
    await assertSessionAuthenticated(page);
  });

  test("HTTP-only session cookie is set after login", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // platform_session must not appear in document.cookie (it's HttpOnly)
    const cookieValue = await page.evaluate(() => document.cookie);
    expect(cookieValue).not.toContain("platform_session");

    // But the session IS active (API responds successfully)
    await assertSessionAuthenticated(page);
  });

  test("response does not expose tokens in /api/session", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    const res = await page.request.get(
      new URL("/api/session", getExternalBaseUrl(page)).toString()
    );
    const body = await res.text();
    expect(body).not.toContain("access_token");
    expect(body).not.toContain("refresh_token");
    expect(body).not.toContain("accessToken");
    expect(body).not.toContain("refreshToken");
  });

  test("landing page shows actor display name and role after login", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    const actorDisplay = page.getByTestId("actor-display");
    await expect(actorDisplay).toBeVisible();
    // The display should show something (name + role badge)
    const text = await actorDisplay.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("landing page shows backend tool links", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Core tool links must be present (labels from i18n or Caddyfile source)
    await expect(page.getByTestId("tool-link-keycloak")).toBeVisible();
    await expect(page.getByTestId("tool-link-mailpit")).toBeVisible();
    await expect(page.getByTestId("tool-link-minio")).toBeVisible();
  });
});
