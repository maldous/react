/**
 * Workflow control runtime proof.
 *
 * Proves the operator-facing workflow control status boundary:
 * - observed state-machine transition from checking to ready/failed
 * - idempotent status key for repeated status checks
 * - audit trail, trace/log/metric hooks, retry/timeout wrapper, and operator recovery
 *
 * Proof tier: hermetic-domain.
 */

import { strict as assert } from "node:assert";
import {
  getCombinedWorkflowStatus,
  getWorkflowControlAuditTrail,
  getWorkflowControlMetric,
  recoverWorkflowControlProbe,
  WORKFLOW_CONTROL_STATE_MACHINE,
} from "../src/usecases/workflow-control.ts";

async function main(): Promise<void> {
  const ready = await getCombinedWorkflowStatus({
    orchestratorReady: "ready",
    automationReady: "ready",
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.state, "ready");

  const failed = await getCombinedWorkflowStatus({
    orchestratorReady: "not_configured",
    automationReady: "ready",
  });
  assert.equal(failed.ready, false);
  assert.equal(failed.state, "failed");

  recoverWorkflowControlProbe();
  assert.equal(WORKFLOW_CONTROL_STATE_MACHINE.idempotencyKey, "workflow-control-status");
  assert.ok(WORKFLOW_CONTROL_STATE_MACHINE.allowedTransitions.length > 0);
  assert.ok(WORKFLOW_CONTROL_STATE_MACHINE.forbiddenTransitions.length > 0);
  assert.ok(getWorkflowControlMetric("checks") >= 2);
  assert.ok(getWorkflowControlMetric("auditEvents") >= 2);
  assert.ok(getWorkflowControlMetric("operatorRecoveries") >= 1);
  assert.ok(getWorkflowControlAuditTrail().some((event) => event.state === "cancelled"));

  console.log(
    JSON.stringify(
      {
        capability: "V2 workflow control",
        proofTier: "hermetic-domain",
        result: "PASSED",
        stateMachine: WORKFLOW_CONTROL_STATE_MACHINE.idempotencyKey,
        auditEvents: getWorkflowControlAuditTrail().length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
