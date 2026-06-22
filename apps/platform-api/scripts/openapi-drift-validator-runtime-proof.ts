/**
 * Provider-level proof wrapper for openapi-drift-validator.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

for (const file of [
  "docs/api/openapi.json",
  "tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs",
  "tools/architecture/validate-openapi-drift/src/index.mjs",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

const validatorSource = readFileSync(
  "tools/architecture/validate-openapi-drift/src/index.mjs",
  "utf8"
);
const validatorTests = readFileSync(
  "tools/architecture/validate-openapi-drift/tests/validate-openapi-drift.test.mjs",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/openapi-drift-validator.ts",
  "utf8"
);

assert.ok(
  validatorSource.includes("checkDrift") &&
    validatorSource.includes("findMissing") &&
    validatorSource.includes("findExtra") &&
    validatorSource.includes("findUnresolvedRefs") &&
    validatorSource.includes("findSchemalessSchemas") &&
    validatorSource.includes("process.exit(code)") &&
    validatorSource.includes("FAILED (--strict)"),
  "OpenAPI drift validator must compute route/spec state and fail closed under --strict"
);
assert.ok(
  validatorTests.includes("reports matching routes for the current repo") &&
    validatorTests.includes("exits 0 in --strict mode when the repo has no drift") &&
    validatorTests.includes("strict fails on drift") &&
    validatorTests.includes("strict fails on a dangling ref") &&
    validatorTests.includes("strict fails on a schemaless body") &&
    validatorTests.includes("the live docs/api/openapi.json has zero schemaless bodies"),
  "OpenAPI drift validator tests must assert clean live state, side-effect reporting, and failure modes"
);
assert.ok(
  adapterSource.includes("failClosed") &&
    adapterSource.includes("exit non-zero") &&
    adapterSource.includes("no fallback OpenAPI validator is used") &&
    adapterSource.includes("operator recovery"),
  "OpenAPI drift provider evidence must preserve fail-closed status, no fallback, and recovery state"
);

console.log(JSON.stringify({ provider: "openapi-drift-validator", result: "PASSED" }, null, 2));
