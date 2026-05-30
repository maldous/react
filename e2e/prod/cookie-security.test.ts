/**
 * cookie-security.test.ts
 *
 * Production cookie security verification — ensures session cookies have
 * correct security attributes and are not exposed to client-side JS.
 *
 * References: ADR-0022 (token boundary), OWASP Session Management.
 */

import { test, expect } from "@playwright/test";

test.describe("cookies: session cookie attributes", () => {
  test("session cookie is HttpOnly (not accessible via document.cookie)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "platform_session");

    expect(sessionCookie, "platform_session cookie must exist").toBeTruthy();
    expect(sessionCookie!.httpOnly, "platform_session must be HttpOnly").toBe(true);

    // Also verify from JS perspective
    const documentCookies = await page.evaluate(() => document.cookie);
    expect(documentCookies).not.toContain("platform_session");
  });

  test("session cookie has SameSite=Lax or Strict", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "platform_session");

    expect(sessionCookie, "platform_session cookie must exist").toBeTruthy();
    expect(["Lax", "Strict"]).toContain(sessionCookie!.sameSite);
  });

  test("session cookie path is scoped correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "platform_session");

    expect(sessionCookie, "platform_session cookie must exist").toBeTruthy();
    // Path should be / for full-site scope (not overly narrow)
    expect(sessionCookie!.path).toBe("/");
  });

  test("no session cookie values exposed in HTML source", async ({ page }) => {
    // Visit page and grab raw HTML
    const response = await page.goto("/");
    const html = (await response?.text()) ?? "";

    // The HTML source must not contain session cookie values
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "platform_session");
    if (sessionCookie) {
      expect(html).not.toContain(sessionCookie.value);
    }
  });
});

test.describe("cookies: no sensitive data in cookies", () => {
  test("no cookies contain tokens or secrets directly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    for (const cookie of cookies) {
      expect(cookie.name.toLowerCase()).not.toContain("token");
      expect(cookie.name.toLowerCase()).not.toContain("jwt");
      expect(cookie.name.toLowerCase()).not.toContain("secret");
      expect(cookie.name.toLowerCase()).not.toContain("key");
    }
  });

  test("no third-party cookies set", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const expectedDomains = [page.url().hostname.replace(/:\d+$/, ""), "localhost"];
    for (const cookie of cookies) {
      // All cookies should be for our domain
      expect(
        expectedDomains.some((d) => cookie.domain.includes(d)),
        `Unexpected cookie domain: ${cookie.domain}`
      ).toBe(true);
    }
  });
});

test.describe("cookies: cookie count and hygiene", () => {
  test("only essential cookies are set on unauthenticated visit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    // Unauthenticated visit should set minimal cookies
    // platform_session is set by every visit (even unauthenticated — anonymous session)
    expect(cookies.length).toBeLessThanOrEqual(2);
  });

  test("no cookies with future expiry > 1 year (session cookie hygiene)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;

    for (const cookie of cookies) {
      if (cookie.expires) {
        const expiresMs = cookie.expires * 1000;
        const maxAge = expiresMs - Date.now();
        expect(
          maxAge,
          `Cookie ${cookie.name} expires in more than 1 year (${(maxAge / 86400000).toFixed(0)} days)`
        ).toBeLessThanOrEqual(oneYearMs);
      }
    }
  });
});
