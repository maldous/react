import { strict as assert } from "node:assert";
import { getBillingBoundaryReadiness } from "../src/usecases/billing-readiness.ts";
import { getCombinedWorkflowStatus } from "../src/usecases/workflow-control.ts";
import { getBackupControlReport } from "../src/usecases/backup-control.ts";
import { getSecurityControlReport } from "../src/usecases/security-control.ts";

async function main(): Promise<void> {
  const billing = await getBillingBoundaryReadiness();
  const workflow = await getCombinedWorkflowStatus({
    orchestratorReady: "not_configured",
    automationReady: "not_configured",
  });
  const backup = await getBackupControlReport();
  const security = await getSecurityControlReport();
  assert.equal(billing.metrics, "not_configured");
  assert.equal(billing.traces, "not_configured");
  assert.equal(billing.logs, "not_configured");
  assert.equal(billing.errorCapture, "not_configured");
  assert.equal(workflow.orchestrator.traces, "tempo");
  assert.equal(workflow.orchestrator.logs, "loki");
  assert.equal(workflow.automation.traces, "tempo");
  assert.equal(workflow.automation.logs, "loki");
  assert.equal(backup.metrics, "not_configured");
  assert.equal(backup.traces, "not_configured");
  assert.equal(backup.logs, "not_configured");
  assert.equal(backup.errorCapture, "not_configured");
  assert.equal(security.metrics, "prometheus");
  assert.equal(security.traces, "tempo");
  assert.equal(security.logs, "loki");
  assert.equal(security.errorCapture, "sentry");
  console.log(
    JSON.stringify({ capability: "V2 full observability contract", result: "PASSED" }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
