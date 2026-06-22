/**
 * Provider-level proof wrapper for static-assurance-provider.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

for (const file of [
  "tools/v2-readiness/src/adversarial-usf-audit.mjs",
  "tools/v2-readiness/tests/golden.test.mjs",
  "docs/v2-foundation/usf-audit/v1-correction-backlog.json",
  "docs/evidence/stages",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

const summary = JSON.parse(
  readFileSync("docs/v2-foundation/usf-audit/adversarial-assurance-summary.json", "utf8")
) as { status?: string; mustFixInV1Items?: number };
const backlog = JSON.parse(
  readFileSync("docs/v2-foundation/usf-audit/v1-correction-backlog.json", "utf8")
) as unknown[];
assert.ok(summary.status === "PASS" || summary.status === "FAIL", "audit status is explicit");
assert.equal(
  backlog.length,
  summary.mustFixInV1Items,
  "backlog state matches summary must-fix count"
);

console.log(JSON.stringify({ provider: "static-assurance-provider", result: "PASSED" }, null, 2));
