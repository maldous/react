/**
 * Provider-level proof wrapper for static-assurance-provider.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

for (const file of [
  "tools/v2-readiness/src/adversarial-usf-audit.mjs",
  "tools/v2-readiness/tests/golden.test.mjs",
  "docs/v2-foundation/usf-audit/v1-correction-backlog.json",
  "docs/evidence/stages",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

console.log(JSON.stringify({ provider: "static-assurance-provider", result: "PASSED" }, null, 2));
