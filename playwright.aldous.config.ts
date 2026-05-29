/**
 * playwright.aldous.config.ts
 *
 * Smoke tests against the web Compose profile (Caddy + platform-api).
 *
 * Default (local, no /etc/hosts needed):
 *   ALDOUS_BASE_URL=http://localhost — Caddy responds to localhost via :80
 *   Uses LOCAL_FIXTURE_SESSION=tenant-admin for session state.
 *
 * Production target (separate — requires Cloudflare DNS, real login):
 *   ALDOUS_BASE_URL=https://aldous.info — live site via Cloudflare
 *   Use make e2e-prod or set ALDOUS_BASE_URL manually.
 *
 * Run locally (no /etc/hosts required):
 *   make compose-up-web
 *   ALDOUS_BASE_URL=http://localhost npx playwright test --config playwright.aldous.config.ts
 *
 * Run against production:
 *   ALDOUS_BASE_URL=https://aldous.info npx playwright test --config playwright.aldous.config.ts
 */
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env["ALDOUS_BASE_URL"] ?? "http://localhost";

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
