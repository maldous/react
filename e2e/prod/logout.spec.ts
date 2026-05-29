/**
 * aldous-logout.spec.ts
 *
 * Logout and session invalidation E2E — http://aldous.info
 */
import { test, expect } from "@playwright/test";
import { getTestCredentials, loginAs, assertSessionUnauthenticated } from "./helpers.ts";

test.describe("aldous.info: logout and session invalidation", () => {
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
    await page.waitForURL(/aldous\.info/, { timeout: 10_000 });

    // Session must be cleared
    await assertSessionUnauthenticated(page);
  });

  test("after logout, the landing page shows sign-in entry again", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    await page.getByTestId("logout-button").click();
    await page.waitForURL(/aldous\.info/, { timeout: 10_000 });

    // Sign-in entry must reappear
    const signInEntry = page.locator(
      '[data-testid="sign-in-link"], [data-testid="sign-in-button"], h1:has-text("Sign in")'
    );
    await expect(signInEntry.first()).toBeVisible({ timeout: 10_000 });
  });

  test("POST /auth/logout directly returns 2xx or redirect", async ({ page }) => {
    const { username, password } = getTestCredentials();
    await loginAs(page, username, password);

    // Direct logout request
    const res = await page.request.post("/auth/logout");
    // Accepts 200, 302, or 204
    expect([200, 204, 302]).toContain(res.status());
  });
});
