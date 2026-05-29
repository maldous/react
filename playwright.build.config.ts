import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const API_PORT = process.env["PLATFORM_API_PORT"] ?? "3001";
const PREVIEW_PORT = process.env["PREVIEW_PORT"] ?? "4173";

export default defineConfig({
  testDir: "./e2e/dev",
  testMatch: ["**/build.test.ts"],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/build", open: "never" }], ["list"]],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "e2e-results/build",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `LOCAL_FIXTURE_SESSION=tenant-admin node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts`,
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 20000,
      reuseExistingServer: true,
      env: { PLATFORM_API_PORT: API_PORT, LOCAL_FIXTURE_SESSION: "tenant-admin" },
    },
    {
      command: `cd apps/react-enterprise-app && ../../node_modules/.bin/vite build && ../../node_modules/.bin/vite preview --port ${PREVIEW_PORT}`,
      url: `http://localhost:${PREVIEW_PORT}`,
      timeout: 120000,
      reuseExistingServer: false,
      stderr: "ignore",
      env: { PLATFORM_API_PORT: API_PORT },
    },
  ],
});
