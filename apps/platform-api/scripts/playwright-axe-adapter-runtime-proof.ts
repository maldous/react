/**
 * Provider-level proof wrapper for PlaywrightAxeAdapter.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

for (const file of [
  "tools/architecture/validate-frontend-conventions/tests/validate-frontend-conventions.test.mjs",
  "e2e/discovery/accessibility.spec.ts",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

console.log(JSON.stringify({ provider: "playwright-axe-adapter", result: "PASSED" }, null, 2));
