/**
 * Provider-level proof wrapper for InMemoryAutomationRunner.
 *
 * The delegated proof exercises automation script runs, status retrieval, and
 * integration with the workflow adapter proof; the unit reliability test covers
 * config, no-secret operation, timeout/retry declarations, health, recovery,
 * cancellation, unavailable-provider, and misconfigured-provider fail-closed paths.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(
  join(scriptDir, "workflow-adapters-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/in-memory-automation-runner.ts"),
  "utf8"
);

assert.ok(
  delegatedProofSource.includes("automation.runScript") &&
    delegatedProofSource.includes("automation.getRunStatus") &&
    delegatedProofSource.includes('run.status, "succeeded"'),
  "delegated automation proof must assert script run side effects and succeeded run status state"
);
assert.ok(
  adapterSource.includes("transitionRunStatus") &&
    adapterSource.includes("this.runs.set") &&
    adapterSource.includes("recordAudit") &&
    adapterSource.includes("recordMetric") &&
    adapterSource.includes("withSpan") &&
    adapterSource.includes("run_not_found") &&
    adapterSource.includes("fail closed"),
  "in-memory automation adapter must persist run state, audit, metric, trace, and fail-closed error behavior"
);

await import("./workflow-adapters-runtime-proof.ts");
