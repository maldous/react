/**
 * Brokered third-party identity provider E2E (ADR-ACT-0157).
 *
 * Exercises the production-true flow against the mock-oidc fixture:
 *   /login selector → BFF /auth/login?provider → Keycloak broker → mock-oidc
 *   picker → Keycloak callback → BFF /auth/callback → app session.
 *
 * See playwright.identity.config.ts for the required local stack.
 */
import { test, expect, type Page } from "@playwright/test";

const APP = `http://localhost:${process.env["APP_PORT"] ?? "5174"}`;

/** Drive the mock-oidc picker for the given scenario once it appears. */
async function pickScenario(page: Page, scenario: string): Promise<void> {
  await page.waitForSelector('[data-testid="mock-oidc-picker"]', { timeout: 20_000 });
  await page.getByTestId(`scenario-${scenario}`).click();
}

async function sessionStatus(page: Page): Promise<number> {
  const res = await page.request.get(new URL("/api/session", APP).toString());
  return res.status();
}

test.describe("brokered mock identity providers", () => {
  test("/login renders the configured providers", async ({ page }) => {
    await page.goto(new URL("/login", APP).toString());
    await expect(page.getByTestId("login-providers")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sign-in-button")).toBeVisible(); // platform
    await expect(page.getByTestId("login-provider-google")).toBeVisible();
    await expect(page.getByTestId("login-provider-azure")).toBeVisible();
    await expect(page.getByTestId("login-provider-apple")).toBeVisible();
  });

  test("provider list exposes no secrets", async ({ page }) => {
    const res = await page.request.get(new URL("/api/auth/providers", APP).toString());
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).not.toContain("secret");
    expect(body).not.toContain("clientSecret");
  });

  // One full success flow per provider (registration + brokering for all three).
  for (const provider of ["google", "azure", "apple"]) {
    test(`${provider}: verified user authenticates and returns to the app`, async ({ page }) => {
      await page.goto(new URL("/login", APP).toString());
      await page.getByTestId(`login-provider-${provider}`).click();
      await pickScenario(page, "verified");
      await page.waitForURL(new RegExp(`^${APP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`), {
        timeout: 20_000,
      });
      expect(await sessionStatus(page)).toBe(200);
    });
  }

  test("unverified email is rejected by the BFF callback", async ({ page }) => {
    await page.goto(new URL("/login", APP).toString());
    await page.getByTestId("login-provider-google").click();
    await pickScenario(page, "unverified");
    // BFF callback refuses unverified email (mapKeycloakClaims → 401).
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
  });

  test("denied/cancelled login returns a safe app-facing error", async ({ page }) => {
    await page.goto(new URL("/login", APP).toString());
    await page.getByTestId("login-provider-azure").click();
    await pickScenario(page, "denied");
    // Keycloak surfaces the broker error → BFF callback returns a safe 4xx, no session.
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
    const body = await page.content();
    expect(body).not.toMatch(/stack|Error:|at Object\./i);
  });

  test("provider-error returns a safe app-facing error", async ({ page }) => {
    await page.goto(new URL("/login", APP).toString());
    await page.getByTestId("login-provider-apple").click();
    await pickScenario(page, "provider-error");
    await expect(async () => {
      expect(await sessionStatus(page)).toBe(401);
    }).toPass({ timeout: 15_000 });
  });

  test("an invalid provider hint cannot be used for broker injection or open redirect", async ({
    page,
  }) => {
    // Unknown provider → BFF rejects before redirecting anywhere.
    const res = await page.request.get(
      new URL("/auth/login?provider=evil%26kc_idp_hint=attacker", APP).toString(),
      { maxRedirects: 0 }
    );
    expect(res.status()).toBe(400);
    expect(await sessionStatus(page)).toBe(401);
  });
});
