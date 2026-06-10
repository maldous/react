/**
 * Brokered third-party identity provider E2E (ADR-ACT-0157).
 *
 * Exercises the production-true flow against the mock-oidc fixture with a REAL
 * BFF session (no LOCAL_FIXTURE_SESSION). Keycloak is the single login surface:
 *   /login → BFF /auth/login → Keycloak login page (username/password + brokered IdP
 *   buttons) → pick an IdP → mock-oidc picker → Keycloak callback → BFF /auth/callback
 *   → app session.
 *
 * See playwright.identity.config.ts for the dedicated real-auth harness.
 */
import { test, expect, type Page } from "@playwright/test";

const APP_PORT = process.env["E2E_APP_PORT"] ?? "5180";

/** Drive the mock-oidc picker for the given scenario once it appears. */
async function pickScenario(page: Page, scenario: string): Promise<void> {
  await page.waitForSelector('[data-testid="mock-oidc-picker"]', { timeout: 20_000 });
  await page.getByTestId(`scenario-${scenario}`).click();
}

/** GET /api/session against the APP origin explicitly (not relative to the current page).
 * A brokered-IdP failure can leave the browser on Keycloak's own origin (the platform
 * login theme then bounces it to /login, which is same-origin as the app on a real
 * Caddy/Cloudflare deployment but a different port in this split test harness), so a
 * relative /api/session would hit the wrong origin. */
async function sessionStatus(page: Page): Promise<number> {
  const res = await page.request.get(`http://localhost:${APP_PORT}/api/session`);
  return res.status();
}

/** Start a brokered login: /login hands off to the Keycloak login page, then we pick the
 * brokered IdP from Keycloak's "Or sign in with" list (KC is the single login surface). */
async function startLogin(page: Page, provider: string): Promise<void> {
  await page.goto("/login"); // hands off (client redirect) to the Keycloak login page
  const idpLink = page.locator(`a[href*="broker/mock-${provider}/login"]`).first();
  await idpLink.waitFor({ state: "visible", timeout: 20_000 });
  await idpLink.click();
}

test.describe("brokered mock identity providers", () => {
  test("the Keycloak login lists the brokered identity providers", async ({ page }) => {
    await page.goto("/login"); // redirects to the Keycloak login page
    for (const provider of ["google", "azure", "apple"]) {
      await expect(page.locator(`a[href*="broker/mock-${provider}/login"]`).first()).toBeVisible({
        timeout: 20_000,
      });
    }
  });

  test("provider list exposes no secrets", async ({ page }) => {
    const res = await page.request.get("/api/auth/providers");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).not.toContain("secret");
    expect(body).not.toContain("clientSecret");
  });

  // One full success flow per provider (registration + brokering for all three).
  for (const provider of ["google", "azure", "apple"]) {
    test(`${provider}: verified user authenticates and returns to the app`, async ({ page }) => {
      // Start unauthenticated.
      expect(await sessionStatus(page)).toBe(401);
      await startLogin(page, provider);
      await pickScenario(page, "verified");
      // Lands back on the app origin with an authenticated session.
      await page.waitForURL((url) => url.port === APP_PORT && !url.pathname.startsWith("/auth"), {
        timeout: 20_000,
      });
      await expect(async () => {
        expect(await sessionStatus(page)).toBe(200);
      }).toPass({ timeout: 15_000 });
    });
  }

  // NOTE on unverified-email rejection (ADR-ACT-0157):
  // The BFF callback gate (mapKeycloakClaims rejects email_verified !== true) is
  // unit-tested in packages/adapters-keycloak/tests/adapters-keycloak.test.ts. It is
  // NOT exercised here because Keycloak's brokered `emailVerified` is governed by the
  // IdP's top-level `trustEmail` flag, not the per-token email_verified claim — and
  // these mock IdPs use trustEmail=true (the production-correct setting for trusted
  // upstreams like Google/Microsoft/Apple, which only release verified emails). A
  // trusted broker therefore vouches for the email and the BFF never sees an unverified
  // one. The real-path rejection of failed/denied broker logins is covered by the
  // denied + provider-error tests below. See docs/local-development/mock-identity.md.

  test("denied/cancelled login returns a safe app-facing error and no session", async ({
    page,
  }) => {
    await startLogin(page, "azure");
    await pickScenario(page, "denied");
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
    const body = await page.content();
    expect(body).not.toMatch(/stack trace|at Object\.|internalDetails/i);
  });

  test("provider-error returns a safe app-facing error and no session", async ({ page }) => {
    await startLogin(page, "apple");
    await pickScenario(page, "provider-error");
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
  });

  test("unverified email is rejected by the BFF callback (no session)", async ({ page }) => {
    // The broker flow completes (Keycloak trustEmail=true imports the user), but the
    // upstream email_verified=false is surfaced as email_verified_upstream and the BFF
    // callback refuses the login. ADR-ACT-0157.
    expect(await sessionStatus(page)).toBe(401);
    await startLogin(page, "google");
    await pickScenario(page, "unverified");
    // The BFF refuses at the callback and tears down the Keycloak SSO session, returning
    // the browser to /login?authError=… (NOT a bare JSON page, and NOT a stuck KC session
    // that would later cause "different_user_authenticated"). ADR-ACT-0157.
    await page.waitForURL((url) => url.port === APP_PORT && url.pathname === "/login", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("login-auth-error")).toBeVisible();
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
    const body = await page.content();
    expect(body).not.toMatch(/stack trace|at Object\.|internalDetails/i);
  });

  test("sign-out clears the session — no silent re-auth", async ({ page }) => {
    // Establish a real authenticated session.
    await startLogin(page, "google");
    await pickScenario(page, "verified");
    await page.waitForURL((url) => url.port === APP_PORT && !url.pathname.startsWith("/auth"), {
      timeout: 20_000,
    });
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(200);
    }).toPass({ timeout: 15_000 });

    // Sign out. With id_token_hint (ADR-ACT-0157) Keycloak skips its "Do you want to log
    // out?" confirmation and ends the SSO session; /login then hands back to the Keycloak
    // login (the single login surface). The session must be gone — no silent re-auth.
    await page.getByTestId("logout-button").click();
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 20_000 });
  });

  test("an invalid provider hint cannot be used for broker injection or open redirect", async ({
    page,
  }) => {
    expect(await sessionStatus(page)).toBe(401);
    const res = await page.request.get("/auth/login?provider=evil%26kc_idp_hint=attacker", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
    expect(await sessionStatus(page)).toBe(401);
  });
});
