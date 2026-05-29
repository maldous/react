/**
 * playwright.real-auth.config.ts
 *
 * Real Keycloak browser login E2E tests against http://aldous.info.
 * No LOCAL_FIXTURE_SESSION — every test exercises the real auth flow.
 *
 * Prerequisites (see docs/local-development/real-login-e2e.md):
 *   1. /etc/hosts: 127.0.0.1 aldous.info
 *   2. make compose-up-default
 *   3. make compose-up-identity     # starts Keycloak (identity profile)
 *   4. make keycloak-provision      # terraform apply — provisions realm + users
 *   5. PLATFORM_API_URL=http://aldous.info \
 *      APP_BASE_URL=http://aldous.info \
 *      make compose-up-web          # starts Caddy + platform-api with correct URLs
 *   6. Set KEYCLOAK_TEST_USERNAME and KEYCLOAK_TEST_PASSWORD env vars
 *      (defaults: sysadmin@aldous.info / password from local.tfvars)
 *
 * Run:
 *   KEYCLOAK_TEST_USERNAME=sysadmin@aldous.info \
 *   KEYCLOAK_TEST_PASSWORD=password \
 *   npx playwright test --config playwright.real-auth.config.ts
 */
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

// Fail fast if the stack is clearly not running
const BASE_URL = process.env["REAL_AUTH_BASE_URL"] ?? "http://aldous.info";

export default defineConfig({
  testDir: "./e2e/real-auth",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/real-auth", open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // HTTP-only cookie tests require credentials to be sent
    extraHTTPHeaders: {},
  },
  outputDir: "e2e-results/real-auth",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer — the full stack (Caddy + platform-api + Keycloak) must
  // already be running. Tests abort with a clear message if not reachable.
});
