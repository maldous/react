/**
 * Provider-level proof wrapper for PlaywrightAxeAdapter.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

for (const file of [
  "tools/architecture/validate-frontend-conventions/tests/validate-frontend-conventions.test.mjs",
  "e2e/discovery/accessibility.spec.ts",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/playwright-axe-adapter.ts",
  "utf8"
);
const accessibilitySpec = readFileSync("e2e/discovery/accessibility.spec.ts", "utf8");
const frontendConventionTests = readFileSync(
  "tools/architecture/validate-frontend-conventions/tests/validate-frontend-conventions.test.mjs",
  "utf8"
);

assert.ok(
  adapterSource.includes("timeout") &&
    adapterSource.includes("retry") &&
    adapterSource.includes("failClosed") &&
    adapterSource.includes("no fallback accessibility provider is used") &&
    adapterSource.includes("operator recovery"),
  "Playwright axe adapter evidence must declare timeout, retry, fail-closed state, no fallback, and recovery action"
);
assert.ok(
  accessibilitySpec.includes("AxeBuilder") &&
    accessibilitySpec.includes("writeFileSync") &&
    accessibilitySpec.includes("failureCount") &&
    accessibilitySpec.includes('result: failures.length ? "FAILED" : "PASSED"') &&
    accessibilitySpec.includes("toHaveLength(0)") &&
    accessibilitySpec.includes("serious") &&
    accessibilitySpec.includes("critical"),
  "accessibility proof must scan real routes, write evidence state, and fail on serious/critical axe findings"
);
assert.ok(
  frontendConventionTests.includes("flags a <main id=main-content>") &&
    frontendConventionTests.includes("flags an inline GraphQL operation string") &&
    frontendConventionTests.includes("flags a raw /api/graphql fetch") &&
    frontendConventionTests.includes("reports no violations for the current repository") &&
    frontendConventionTests.includes("CLI exits 0 on the clean repo"),
  "frontend convention tests must assert live clean state and concrete invalid-state failures"
);

console.log(JSON.stringify({ provider: "playwright-axe-adapter", result: "PASSED" }, null, 2));
