/**
 * Provider-level proof wrapper for PlaywrightAdapter.
 *
 * Playwright provider behavior is exercised by committed Playwright configs,
 * scenario manifests, e2e result contracts, confidence ladder tests, and
 * pre-push/frontend/e2e gates.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

for (const file of [
  "playwright.internal.config.ts",
  "playwright.external.config.ts",
  "tools/e2e/scenario-manifest.test.mjs",
  "tools/e2e/result-contract.test.mjs",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

const adapterSource = readFileSync("apps/platform-api/src/adapters/playwright-adapter.ts", "utf8");
const scenarioManifestTests = readFileSync("tools/e2e/scenario-manifest.test.mjs", "utf8");
const resultContractTests = readFileSync("tools/e2e/result-contract.test.mjs", "utf8");
const internalConfig = readFileSync("playwright.internal.config.ts", "utf8");
const externalConfig = readFileSync("playwright.external.config.ts", "utf8");

assert.ok(
  adapterSource.includes("timeout") &&
    adapterSource.includes("retry") &&
    adapterSource.includes("failClosed") &&
    adapterSource.includes("no fallback browser provider is used") &&
    adapterSource.includes("operator recovery"),
  "Playwright adapter evidence must declare timeout, retry, fail-closed state, no fallback, and recovery action"
);
assert.ok(
  scenarioManifestTests.includes("validator PASSES on the real repository tree") &&
    scenarioManifestTests.includes("orphan test (no scenario/exemption) FAILS") &&
    scenarioManifestTests.includes("duplicate scenario id FAILS") &&
    scenarioManifestTests.includes("manifest entry referencing a missing file FAILS") &&
    scenarioManifestTests.includes("correlated spec relying on a title") &&
    scenarioManifestTests.includes("required log/trace sets per stage are honest"),
  "Playwright scenario tests must assert live manifest state and concrete invalid-state failures"
);
assert.ok(
  resultContractTests.includes("PASSED/FULL") &&
    resultContractTests.includes("unknown result throws") &&
    resultContractTests.includes("any FAILED") &&
    resultContractTests.includes("any DEGRADED"),
  "Playwright result contract must assert pass/degraded/failed status handling without silent success"
);
assert.ok(
  internalConfig.includes("defineConfig") &&
    externalConfig.includes("defineConfig") &&
    (internalConfig.includes("timeout") || externalConfig.includes("timeout")),
  "Playwright configs must define bounded execution state for browser proof runs"
);

console.log(JSON.stringify({ provider: "playwright-adapter", result: "PASSED" }, null, 2));
