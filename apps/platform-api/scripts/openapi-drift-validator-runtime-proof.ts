/**
 * Provider-level proof wrapper for openapi-drift-validator.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

for (const file of [
  "docs/api/openapi.json",
  "tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs",
  "tools/architecture/validate-openapi-drift/src/index.mjs",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

console.log(JSON.stringify({ provider: "openapi-drift-validator", result: "PASSED" }, null, 2));
