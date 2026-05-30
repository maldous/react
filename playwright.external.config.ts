import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env["PROD_BASE_URL"] ?? "https://aldous.info";

export default defineConfig({
  testDir: "./e2e/external",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 1,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/external", open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    extraHTTPHeaders: {},
  },
  outputDir: "e2e-results/external",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer — the external stack must already be running at PROD_BASE_URL.
});
