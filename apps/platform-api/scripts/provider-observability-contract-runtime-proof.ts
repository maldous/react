import { strict as assert } from "node:assert";
import { getBillingBoundaryReadiness } from "../src/usecases/billing-readiness.ts";
import { getCombinedWorkflowStatus } from "../src/usecases/workflow-control.ts";
import { emitRuntimeProofObservabilityEvidence } from "./lib/runtime-evidence.ts";

emitRuntimeProofObservabilityEvidence("provider-observability-contract");

async function main(): Promise<void> {
  const billing = await getBillingBoundaryReadiness();
  const workflow = await getCombinedWorkflowStatus({
    orchestratorReady: "not_configured",
    automationReady: "not_configured",
  });
  assert.equal(billing.metrics, "not_configured");
  assert.equal(billing.traces, "not_configured");
  assert.equal(billing.logs, "not_configured");
  assert.equal(billing.errorCapture, "not_configured");
  assert.equal(workflow.orchestrator.traces, "tempo");
  assert.equal(workflow.orchestrator.logs, "loki");
  assert.equal(workflow.automation.traces, "tempo");
  assert.equal(workflow.automation.logs, "loki");
  console.log(
    JSON.stringify(
      {
        capability: "V2 provider observability contract",
        result: "PASSED",
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
