/**
 * playwright.prod.config.ts
 *
 * Playwright config for testing the PRODUCTION build of the React SPA.
 * Uses `vite preview` to serve the built dist/ directory.
 *
 * This config addresses the ADR-0025 gap where the standard E2E tests only
 * run against the Vite dev server. Production-only failures (React dedupe,
 * missing CSS imports, bundle split issues) would not be caught otherwise.
 *
 * Run:
 *   cd apps/react-enterprise-app && npx vite build   # build first
 *   npm run test:e2e:prod                             # then test
 *
 * Or as a single command:
 *   npm run test:e2e:prod
 */
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const API_PORT = process.env["PLATFORM_API_PORT"] ?? "3001";
const PREVIEW_PORT = process.env["PREVIEW_PORT"] ?? "4173";

export default defineConfig({
  testDir: "./e2e/prod",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/prod", open: "never" }], ["list"]],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "e2e-results/prod",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // BFF must be running before the preview server starts
      command: `LOCAL_FIXTURE_SESSION=tenant-admin node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts`,
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 20000,
      reuseExistingServer: true,
      env: { PLATFORM_API_PORT: API_PORT, LOCAL_FIXTURE_SESSION: "tenant-admin" },
    },
    {
      // Build then preview the production bundle
      command: `cd apps/react-enterprise-app && ../../node_modules/.bin/vite build && ../../node_modules/.bin/vite preview --port ${PREVIEW_PORT}`,
      url: `http://localhost:${PREVIEW_PORT}`,
      timeout: 120000,
      reuseExistingServer: false,
      env: { PLATFORM_API_PORT: API_PORT },
    },
  ],
});
