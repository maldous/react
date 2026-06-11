/**
 * aldous-logout.spec.ts
 *
 * Logout and session invalidation E2E — http://aldous.info
 */
import { test, expect } from "@playwright/test";
import {
  getExternalBaseUrl,
  getTestCredentials,
  loginAs,
  assertSessionUnauthenticated,
} from "./helpers.ts";

const TARGET_HOST = new URL(process.env["PROD_BASE_URL"] || "http://aldous.info").hostname;
const TARGET_HOST_RE = new RegExp(TARGET_HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test.describe(`${TARGET_HOST}: logout and session invalidation`, () => {
  test.beforeEach(({}, testInfo) => {
    try {
      getTestCredentials();
    } catch {
      testInfo.skip();
    }
  });

  test("logout clears session — /api/session returns 401 after logout", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Click the logout button
    await page.getByTestId("logout-button").click();

    // Wait for the page to return to unauthenticated state
    await page.waitForURL(TARGET_HOST_RE, { timeout: 10_000 });

    // Session must be cleared
    await assertSessionUnauthenticated(page);
  });

  test("after logout, the landing page shows sign-in entry again", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);
    const baseUrl = getExternalBaseUrl(page);

    // Navigate directly to the logout endpoint. The platform destroys the Redis
    // session and clears the cookie before redirecting to Keycloak. We use a short
    // timeout because we only need the platform-side action to complete — we don't
    // wait for the KC end_session chain (which requires terraform apply to register
    // post_logout_redirect_uris and may show a confirmation page).
    await page
      .goto(`${baseUrl}/auth/logout?returnTo=/login`, {
        waitUntil: "domcontentloaded",
        timeout: 8_000,
      })
      .catch(() => {
        // Timeout or KC error — the platform session was destroyed before any KC
        // redirect, so we can proceed to verify the unauthenticated state.
      });

    // Navigate to the platform root. Aborts any ongoing KC redirect chain.
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Platform session must be cleared
    await assertSessionUnauthenticated(page);

    // Sign-in entry must be visible on the platform root
    const signInEntry = page.locator(
      '[data-testid="sign-in-link"], [data-testid="sign-in-button"], h1:has-text("Sign in")'
    );
    await expect(signInEntry.first()).toBeVisible({ timeout: 10_000 });
  });

  test("POST /auth/logout directly returns 2xx or redirect", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Direct logout request
    const res = await page.request.post(
      new URL("/auth/logout", getExternalBaseUrl(page)).toString()
    );
    // Accepts 200, 302, or 204
    expect([200, 204, 302]).toContain(res.status());
  });

  test("GET /auth/logout redirects to Keycloak end_session, not platform 404", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Navigate to GET /auth/logout?returnTo=/login — must redirect to KC end_session
    const res = await page.request.get(
      new URL("/auth/logout?returnTo=/login", getExternalBaseUrl(page)).toString(),
      { maxRedirects: 0, failOnStatusCode: false }
    );
    expect(res.status(), "GET /auth/logout must redirect (302)").toBe(302);

    const location = res.headers()["location"] ?? "";
    // Must redirect to Keycloak end_session endpoint, not the platform app
    expect(location, "redirect must point to Keycloak end_session endpoint").toMatch(
      /\/protocol\/openid-connect\/logout/
    );
    expect(location, "end_session URL must include client_id").toContain("client_id=");
    expect(location, "end_session URL must include post_logout_redirect_uri").toContain(
      "post_logout_redirect_uri="
    );
  });

  test("after full GET logout, visiting /login requires Keycloak credentials — no silent re-auth", async ({
    page,
  }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Perform browser-navigation logout (follows redirect chain through KC end_session)
    await page.goto(new URL("/auth/logout?returnTo=/login", getExternalBaseUrl(page)).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // After KC logout, we should land on /login (via post_logout_redirect_uri)
    // OR on a Keycloak login page. Both are acceptable; what is NOT acceptable is
    // being silently returned to the platform as the same user.
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

    // Platform session must be gone — /api/session must return 401
    await assertSessionUnauthenticated(page);

    // The page must NOT show the authenticated landing (user data)
    const pageText = await page.textContent("body").catch(() => "");
    expect(pageText, "landing after logout must not show authenticated user content").not.toMatch(
      /sign out|logout-button/i
    );

    // If we're on the platform /login, attempting to proceed must redirect to KC,
    // NOT silently return as the same user. This verifies the KC SSO session is gone.
    const currentUrl = page.url();
    if (currentUrl.includes("/login") && !currentUrl.includes("keycloak")) {
      // Click the PLATFORM sign-in specifically (testid "sign-in-button"). When mock
      // IdPs are enabled the /login page also lists google/azure/apple, whose
      // /auth/login links would otherwise be matched first and route to the broker
      // picker instead of the Keycloak credential form (ADR-ACT-0157).
      const signInBtn = page.getByTestId("sign-in-button");
      if (await signInBtn.count()) {
        await signInBtn.first().click();
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
        // KC login page must show username/password fields — NOT silently re-authenticate
        const hasUsernameField = await page
          .locator('input[name="username"], input[type="text"], input[id="username"]')
          .count();
        expect(
          hasUsernameField,
          "KC login page must show credential form — SSO session must be cleared"
        ).toBeGreaterThan(0);
      }
    }
  });
});
