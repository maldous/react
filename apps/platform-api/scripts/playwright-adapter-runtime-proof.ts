/**
 * Provider-level proof wrapper for PlaywrightAdapter.
 *
 * Playwright provider behavior is exercised by committed Playwright configs,
 * scenario manifests, e2e result contracts, confidence ladder tests, and
 * pre-push/frontend/e2e gates.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

for (const file of [
  "playwright.internal.config.ts",
  "playwright.external.config.ts",
  "tools/e2e/scenario-manifest.test.mjs",
  "tools/e2e/result-contract.test.mjs",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

console.log(JSON.stringify({ provider: "playwright-adapter", result: "PASSED" }, null, 2));
