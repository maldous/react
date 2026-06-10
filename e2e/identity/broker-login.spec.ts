/**
 * Brokered third-party identity provider E2E (ADR-ACT-0157).
 *
 * Exercises the production-true flow against the mock-oidc fixture with a REAL
 * BFF session (no LOCAL_FIXTURE_SESSION):
 *   /login selector → BFF /auth/login?provider → Keycloak broker → mock-oidc
 *   picker → Keycloak callback → BFF /auth/callback → app session.
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

/** GET /api/session through the app origin (real session cookie, not a fixture). */
async function sessionStatus(page: Page): Promise<number> {
  const res = await page.request.get("/api/session");
  return res.status();
}

async function startLogin(page: Page, provider: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByTestId("login-providers")).toBeVisible({ timeout: 10_000 });
  await page
    .getByTestId(provider === "platform" ? "sign-in-button" : `login-provider-${provider}`)
    .click();
}

test.describe("brokered mock identity providers", () => {
  test("/login renders the configured providers", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-providers")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sign-in-button")).toBeVisible(); // platform
    await expect(page.getByTestId("login-provider-google")).toBeVisible();
    await expect(page.getByTestId("login-provider-azure")).toBeVisible();
    await expect(page.getByTestId("login-provider-apple")).toBeVisible();
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
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
    const body = await page.content();
    expect(body).not.toMatch(/stack trace|at Object\.|internalDetails/i);
  });

  test("sign-out clears the session and returns to the app (no Keycloak confirmation page)", async ({
    page,
  }) => {
    // Establish a real authenticated session.
    await startLogin(page, "google");
    await pickScenario(page, "verified");
    await page.waitForURL((url) => url.port === APP_PORT && !url.pathname.startsWith("/auth"), {
      timeout: 20_000,
    });
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(200);
    }).toPass({ timeout: 15_000 });

    // Sign out. With id_token_hint (ADR-ACT-0157) Keycloak skips the
    // "Do you want to log out?" confirmation and redirects straight back to the
    // app /login; without it the browser would strand on a /kc/... page and this
    // waitForURL would time out.
    await page.getByTestId("logout-button").click();
    await page.waitForURL((url) => url.port === APP_PORT && url.pathname === "/login", {
      timeout: 20_000,
    });
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
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
