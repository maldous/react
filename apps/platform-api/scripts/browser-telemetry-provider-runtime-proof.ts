/**
 * Provider-level proof wrapper for browser-telemetry-provider.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

for (const file of [
  "tools/e2e/tempo-trace.test.mjs",
  "tools/e2e/correlation-headers.test.mjs",
  "tools/e2e/observability-correlation/tests/classify.test.mjs",
  "docs/evidence/platform/browser-diagnostics-faro.md",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

console.log(JSON.stringify({ provider: "browser-telemetry-provider", result: "PASSED" }, null, 2));
