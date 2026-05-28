import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const API_PORT = process.env["PLATFORM_API_PORT"] ?? "3001";
const APP_PORT = process.env["APP_PORT"] ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "e2e-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `LOCAL_FIXTURE_SESSION=tenant-admin node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts`,
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 20000,
      reuseExistingServer: true,
      env: {
        PLATFORM_API_PORT: API_PORT,
        LOCAL_FIXTURE_SESSION: "tenant-admin",
      },
    },
    {
      command: `cd apps/react-enterprise-app && npx vite --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      timeout: 30000,
      reuseExistingServer: true,
      env: {
        PLATFORM_API_PORT: API_PORT,
      },
    },
  ],
});
