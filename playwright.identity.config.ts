import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Broker login E2E (ADR-ACT-0157) — drives the real flow:
 *   React /login → BFF /auth/login?provider → Keycloak (broker) → mock-oidc
 *               → Keycloak callback → BFF /auth/callback → app session.
 *
 * This harness runs its OWN real-auth BFF + Vite on dedicated ports so it does
 * NOT collide with (or reuse) the Tilt dev loop, which runs the BFF with
 * LOCAL_FIXTURE_SESSION (that fixture would make /api/session always 200 and
 * mask the real broker result). Dedicated ports:
 *   - BFF  : E2E_API_PORT (default 3099), real auth, AUTH_PROVIDER_MODE=mock
 *   - app  : E2E_APP_PORT (default 5180), Vite, proxying /auth+/api to the BFF
 * global-setup registers the app origin as a redirect URI on the platform-api
 * Keycloak client. The Vite proxy keeps /auth+/api on the browser origin
 * (changeOrigin:false) and /kc on Keycloak (changeOrigin:true), so the whole
 * chain stays anchored on the app origin and KC_HOSTNAME stays strict.
 *
 * Prerequisites (see docs/local-development/mock-identity.md):
 *   make compose-up-default            # redis + postgres (migrated)
 *   make compose-up-identity           # Keycloak
 *   make keycloak-provision ENV=dev    # platform realm + BFF client
 *   make compose-up-identity-mocks     # mock-oidc fixture
 *   make seed-idps ENV=dev             # register mock-google/azure/apple
 * Then: npm run test:e2e:identity
 */
const API_PORT = process.env["E2E_API_PORT"] ?? "3099";
const APP_PORT = process.env["E2E_APP_PORT"] ?? "5180";

// Load .env.dev (gitignored) into the BFF + Vite servers so they get the same
// Postgres/Redis/Keycloak/encryption config the dev stack uses — then override
// the port, force real auth (clear LOCAL_FIXTURE_SESSION) and mock provider mode.
const loadDevEnv = "set -a; [ -f .env.dev ] && . ./.env.dev; set +a;";

export default defineConfig({
  testDir: "./e2e/identity",
  testMatch: ["**/*.spec.ts"],
  globalSetup: "./e2e/identity/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  timeout: 60_000,
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
      command: `bash -c '${loadDevEnv} exec env PLATFORM_API_PORT=${API_PORT} AUTH_PROVIDER_MODE=mock LOCAL_FIXTURE_SESSION= node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts'`,
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `${loadDevEnv} cd apps/react-enterprise-app && PLATFORM_API_PORT=${API_PORT} VITE_E2E=true npx vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
