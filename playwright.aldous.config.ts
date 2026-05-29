/**
 * playwright.aldous.config.ts
 *
 * Playwright config for live smoke tests against https://aldous.info.
 * No local server is started — the stack must already be running via
 * `docker compose --profile web up -d`.
 *
 * Run: npx playwright test --config playwright.aldous.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/aldous",
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/aldous", open: "never" }], ["list"]],
  use: {
    baseURL: "https://aldous.info",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "e2e-results/aldous",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer — targeting the live deployment
});
