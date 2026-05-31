/**
 * Shared helpers for real-auth E2E tests (aldous.info).
 * All helpers assume the full stack is running and aldous.info resolves locally.
 */
import { type Page, expect } from "@playwright/test";

export function getExternalBaseUrl(page?: Page): string {
  const envBase = process.env["PROD_BASE_URL"] || "http://aldous.info";
  if (page) {
    try {
      const url = new URL(page.url());
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin;
      }
    } catch {
      // Ignore: page.url() is not usable before first navigation.
    }
  }
  return envBase.replace(/\/+$/, "");
}

/** Credentials from environment — tests skip if not provided */
export function getTestCredentials(): { username: string; password: string } {
  const username = process.env["KEYCLOAK_TEST_USERNAME"] ?? "";
  const password = process.env["KEYCLOAK_TEST_PASSWORD"] ?? "";
  if (!username || !password) {
    throw new Error(
      "KEYCLOAK_TEST_USERNAME and KEYCLOAK_TEST_PASSWORD must be set.\n" +
        "See docs/local-development/real-login-e2e.md for setup instructions."
    );
  }
  return { username, password };
}

/**
 * Complete the Keycloak username/password login form.
 * Waits for the Keycloak login page to fully load before filling.
 */
export async function completeKeycloakLogin(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  // Keycloak login form — standard field IDs in Keycloak 26.x
  await page.waitForSelector("#username", { state: "visible", timeout: 15_000 });
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click('[type="submit"]');
}

/**
 * Navigate to / and perform the full Keycloak login flow.
 *
 * Two-hop flow:
 *   / (homepage) → click sign-in-link → /login (React themed entry)
 *                → click sign-in-button → /auth/login (BFF, Caddy-proxied)
 *                → Keycloak PKCE → fill credentials → /auth/callback → /
 *
 * Returns after the post-login redirect back to the app root completes.
 */
export async function loginAs(page: Page, username: string, password: string): Promise<void> {
  const baseUrl = getExternalBaseUrl();
  await page.goto(new URL("/", baseUrl).toString());
  const appOrigin = new URL(page.url()).origin;

  // Hop 1: from homepage click the sign-in entry link → /login (React page)
  await page.getByTestId("sign-in-link").click();

  // Hop 2: from /login click the sign-in button → /auth/login (BFF PKCE start)
  await page.getByTestId("sign-in-button").click();

  // Complete Keycloak login form
  await completeKeycloakLogin(page, username, password);

  // Wait for redirect back to the app root (excludes /auth/callback)
  const escapedOrigin = appOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.waitForURL(new RegExp(`^${escapedOrigin}/?$`), { timeout: 20_000 });
  // Confirm session is active
  await expect(page.getByTestId("actor-display")).toBeVisible({ timeout: 10_000 });
}

/**
 * Verify /api/session returns an authenticated actor.
 */
export async function assertSessionAuthenticated(page: Page): Promise<void> {
  const res = await page.request.get(new URL("/api/session", getExternalBaseUrl(page)).toString());
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { userId?: string; roles?: string[] };
  expect(body.userId).toBeTruthy();
}

/**
 * Verify /api/session returns 401 (unauthenticated).
 */
export async function assertSessionUnauthenticated(page: Page): Promise<void> {
  const res = await page.request.get(new URL("/api/session", getExternalBaseUrl(page)).toString());
  expect(res.status()).toBe(401);
}
