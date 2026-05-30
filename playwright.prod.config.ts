import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env["PROD_BASE_URL"] ?? "http://localhost:83";

export default defineConfig({
  testDir: "./e2e/prod",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 1,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/prod", open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    extraHTTPHeaders: {},
  },
  outputDir: "e2e-results/prod",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer ? the prod-like stack must already be running.
});
