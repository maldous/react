/**
 * aldous-auth-negative.spec.ts
 *
 * Negative authentication tests — http://aldous.info
 *
 * Tests that bad credentials and unsupported auth models are handled correctly.
 * Some models are skipped because current provisioning doesn't support them;
 * those are tracked in ACTION-REGISTER (ADR-ACT-0157 through ADR-ACT-0160).
 */
import { test, expect } from "@playwright/test";
import { getExternalBaseUrl } from "./helpers.ts";

const BASE_URL =
  process.env["REAL_AUTH_BASE_URL"] || process.env["PROD_BASE_URL"] || "http://aldous.info";
const TARGET_HOST = new URL(BASE_URL).hostname;

test.describe(`${TARGET_HOST}: wrong credentials`, () => {
  test("wrong password shows Keycloak error on login form", async ({ page }) => {
    // /auth/login on the BFF triggers the PKCE redirect to Keycloak directly.
    // Caddy proxies /auth/* to platform-api, so there is no intermediate SPA login page.
    await page.goto(new URL("/auth/login", getExternalBaseUrl(page)).toString());

    // Fill wrong credentials on Keycloak form
    await page.waitForSelector("#username", { state: "visible", timeout: 15_000 });
    await page.fill("#username", "sysadmin@aldous.info");
    await page.fill("#password", "definitely-wrong-password-xyz");
    await page.click('[type="submit"]');

    // Keycloak shows an error — either "Invalid credentials" text or the form stays
    // We do not land back on aldous.info
    await page.waitForTimeout(2_000);
    const currentUrl = page.url();
    // Must NOT have redirected back to aldous.info with a valid session
    const hasSession = currentUrl.startsWith(BASE_URL) && !currentUrl.includes("/kc/");
    if (hasSession) {
      // If somehow we're back at aldous.info, session must NOT be authenticated
      const res = await page.request.get(
        new URL("/api/session", getExternalBaseUrl(page)).toString()
      );
      expect(res.status()).toBe(401);
    } else {
      // Still on Keycloak — form remained, which is the expected error behaviour
      expect(currentUrl).toContain("/kc/");
    }
  });
});

// ---------------------------------------------------------------------------
// Auth models not yet supported by current Keycloak provisioning.
// Tests are skipped — corresponding ACTION-REGISTER items created below.
// ---------------------------------------------------------------------------

test.describe(`${TARGET_HOST}: deferred auth models (provisioning not yet available)`, () => {
  test.skip(
    true,
    "OIDC broker login (ADR-ACT-0157): Requires OIDC IdP configured in platform realm. " +
      "See ACTION-REGISTER for provisioning steps."
  );
  test("OIDC broker login", async () => {
    /* intentionally empty */
  });

  test.skip(
    true,
    "SAML broker login (ADR-ACT-0157): Requires SAML IdP configured in platform realm."
  );
  test("SAML broker login", async () => {
    /* intentionally empty */
  });

  test.skip(
    true,
    "MFA-required login (ADR-ACT-0158): Requires OTP/WebAuthn policy enabled in realm. " +
      "The fixture user does not require MFA by default."
  );
  test("MFA-required login", async () => {
    /* intentionally empty */
  });

  test.skip(
    true,
    "Disabled user (ADR-ACT-0159): Requires a fixture user with enabled=false provisioned in Keycloak."
  );
  test("disabled user is rejected", async () => {
    /* intentionally empty */
  });

  test.skip(
    true,
    "Unverified email (ADR-ACT-0159): Requires a fixture user with email_verified=false. " +
      "Current realm has verify_email=false so all users are considered verified."
  );
  test("unverified email user is rejected", async () => {
    /* intentionally empty */
  });

  test.skip(
    true,
    "Expired session behaviour (ADR-ACT-0160): Requires manipulating token lifetime " +
      "or waiting for session expiry. Not automated in initial test pass."
  );
  test("expired session is rejected", async () => {
    /* intentionally empty */
  });
});
