import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

// Headless journeys for the Semantic Reference Harness. The harness is fully self-contained:
// MSW intercepts the declared BFF contracts in-browser, so NO platform-api/Compose is required.
const PORT = process.env["HARNESS_PORT"] ?? "5180";

export default defineConfig({
  testDir: "./playwright",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  // Keep artifacts under the already-gitignored e2e-results/ tree (never committed).
  outputDir: "e2e-results/ui-harness",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --config tools/ui-reference-harness/vite.config.ts --port ${PORT}`,
    cwd: process.cwd(),
    url: `http://localhost:${PORT}`,
    timeout: 60000,
    reuseExistingServer: !process.env["CI"],
    stderr: "ignore",
    env: { HARNESS_PORT: PORT },
  },
});
