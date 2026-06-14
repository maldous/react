import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

// ADR-ACT-0285 Phase 4 — dynamic clickability crawler config. Runs against an
// already-running stack at PROD_BASE_URL (per-stage: localhost:<web> for dev/test,
// real domain for staging/prod). Trace + screenshot + video retained on failure
// for evidence (workstream 4).
const BASE_URL = process.env["PROD_BASE_URL"] ?? "http://localhost:83";

export default defineConfig({
  testDir: "./e2e/discovery",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report/discovery", open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "e2e-results/discovery",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer — the stack must already be running at PROD_BASE_URL.
});
