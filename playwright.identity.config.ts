import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Broker login E2E (ADR-ACT-0157) — drives the real flow:
 *   React /login → BFF /auth/login?provider → Keycloak (broker) → mock-oidc
 *               → Keycloak callback → BFF /auth/callback → app session.
 *
 * Unlike playwright.internal.config.ts, the BFF here runs WITHOUT
 * LOCAL_FIXTURE_SESSION so real Keycloak brokering is exercised.
 *
 * Prerequisites (not started by this config):
 *   make compose-up-default          # redis (+ postgres)
 *   make compose-up-identity         # Keycloak
 *   make keycloak-provision ENV=dev  # platform realm + BFF client
 *   make compose-up-identity-mocks   # mock-oidc fixture
 *   make seed-idps ENV=dev           # register mock-google/azure/apple
 * Then: npm run test:e2e:identity
 */
const API_PORT = process.env["PLATFORM_API_PORT"] ?? "3001";
const APP_PORT = process.env["APP_PORT"] ?? "5174";

export default defineConfig({
  testDir: "./e2e/identity",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/identity", open: "never" }], ["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "e2e-results/identity",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Real auth (no LOCAL_FIXTURE_SESSION). Inherits KEYCLOAK_*, AUTH_PROVIDER_MODE,
      // MOCK_OIDC_*, TENANT_SECRET_ENCRYPTION_KEY, REDIS_URL from the environment.
      command: `node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts`,
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 30000,
      reuseExistingServer: !process.env["CI"],
      env: { PLATFORM_API_PORT: API_PORT, AUTH_PROVIDER_MODE: "mock" },
    },
    {
      command: `cd apps/react-enterprise-app && npx vite --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 30000,
      reuseExistingServer: !process.env["CI"],
      stderr: "ignore",
      env: { PLATFORM_API_PORT: API_PORT, VITE_E2E: "true" },
    },
  ],
});
