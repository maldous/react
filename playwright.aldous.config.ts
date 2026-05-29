/**
 * playwright.aldous.config.ts
 *
 * Smoke tests against the aldous.info stack.
 *
 * Local (default): http://aldous.info — requires 127.0.0.1 aldous.info in /etc/hosts
 *   and `make compose-up-web` running.
 *
 * Production: set ALDOUS_BASE_URL=https://aldous.info to smoke-test the live site.
 *
 * Run:
 *   npx playwright test --config playwright.aldous.config.ts          # local
 *   ALDOUS_BASE_URL=https://aldous.info npx playwright test --config playwright.aldous.config.ts  # prod
 */
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env["ALDOUS_BASE_URL"] ?? "http://aldous.info";

export default defineConfig({
  testDir: "./e2e/aldous",
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/aldous", open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "e2e-results/aldous",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer — the stack must already be running
});
