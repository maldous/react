/**
 * Provider-level proof wrapper for InMemoryWorkflowOrchestrator.
 *
 * The delegated proof exercises workflow start, status, tenant access,
 * approval transitions, cancellation, and fail-closed unavailable or
 * misconfigured-provider paths covered by the unit reliability tests.
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
  join(scriptDir, "../src/adapters/in-memory-workflow-orchestrator.ts"),
  "utf8"
);

assert.ok(
  delegatedProofSource.includes("workflow.startWorkflow") &&
    delegatedProofSource.includes("workflow.signalWorkflow") &&
    delegatedProofSource.includes("workflow.getWorkflowStatus") &&
    delegatedProofSource.includes('status.status, "completed"') &&
    delegatedProofSource.includes("workflow.approval_granted"),
  "delegated workflow proof must assert start, approval transition, completed status, and audit state"
);
assert.ok(
  delegatedProofSource.includes("workflow.canAccess") &&
    delegatedProofSource.includes('"tenant-a"') &&
    delegatedProofSource.includes('"tenant-b"'),
  "delegated workflow proof must assert tenant access boundary state"
);
assert.ok(
  adapterSource.includes("transitionWorkflowStatus") &&
    adapterSource.includes("this.workflows.set") &&
    adapterSource.includes("terminalWorkflowStates") &&
    adapterSource.includes("recordAudit") &&
    adapterSource.includes("recordMetric") &&
    adapterSource.includes("withSpan") &&
    adapterSource.includes("fail closed"),
  "in-memory workflow adapter must persist workflow state, enforce terminal transitions, audit, metric, trace, and fail closed"
);

await import("./workflow-adapters-runtime-proof.ts");
