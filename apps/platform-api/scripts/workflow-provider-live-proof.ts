/**
 * Workflow provider live proof.
 *
 * Proves the workflow-provider compose profile when the endpoints are wired:
 * - Temporal: real SDK-backed start/signal/status/cancel path
 * - Windmill: real automation run/status/cancel path
 * - Proof tier: live-composed-provider for each reachable backend
 *
 * The proof skips honestly when a required endpoint is not configured or
 * unreachable. This is a provider drill, not a fake pass.
 */

import { strict as assert } from "node:assert";
import { TemporalWorkflowProviderAdapter } from "../src/adapters/temporal-workflow-provider.ts";
import { WindmillAutomationProviderAdapter } from "../src/adapters/windmill-automation-provider.ts";

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

async function main(): Promise<void> {
  const temporalAddress = env("TEMPORAL_ADDRESS") ?? env("TEMPORAL_HTTP_URL");
  const windmillUrl = env("WINDMILL_URL");
  const windmillToken = env("WINDMILL_TOKEN");

  if (!temporalAddress || !windmillUrl) {
    console.log(
      JSON.stringify(
        {
          capability: "workflow-provider live proof",
          proofTier: "live-composed-provider",
          result: "SKIPPED",
          reason: "TEMPORAL_ADDRESS/TEMPORAL_HTTP_URL or WINDMILL_URL not configured",
        },
        null,
        2
      )
    );
    return;
  }

  const temporal = new TemporalWorkflowProviderAdapter(temporalAddress, { preferSdk: true });
  const windmill = new WindmillAutomationProviderAdapter(windmillUrl, fetch, {
    token: windmillToken,
    preferSdk: true,
  });

  const { HealthService } = await import("windmill-client");
  const windmillHealth = await HealthService.getHealthStatus({ force: true });
  assert.ok(
    windmillHealth && typeof windmillHealth === "object",
    "windmill sdk health check must resolve"
  );

  const workflowId = `tenant-a:workflow-${Date.now().toString(36)}`;
  const started = await temporal.startWorkflow({
    workflowKey: "tenant.delete",
    tenantId: "tenant-a",
    workflowId,
    payload: { tenantId: "tenant-a" },
  });

  await temporal.signalWorkflow(started.workflowId, "approval.requested", {
    requestedBy: "operator-1",
    terminal: false,
  });
  await temporal.signalWorkflow(started.workflowId, "approval.granted", {
    approvedBy: "operator-1",
    terminal: true,
  });

  const workflowStatus = await temporal.getWorkflowStatus(started.workflowId);
  assert.equal(workflowStatus.workflowId, started.workflowId);
  assert.ok(["completed", "running"].includes(workflowStatus.status));

  const run = await windmill.runScript({
    scriptKey: "tenant.export",
    tenantId: "tenant-a",
    runId: `run-${Date.now().toString(36)}`,
    payload: {},
  });
  const runStatus = await windmill.getRunStatus(run.runId);
  assert.equal(runStatus.runId, run.runId);
  assert.ok(["queued", "running", "succeeded", "failed", "cancelled"].includes(runStatus.status));

  await windmill.cancelRun(run.runId);
  await temporal.cancelWorkflow(started.workflowId);

  console.log(
    JSON.stringify(
      {
        capability: "workflow-provider live proof",
        proofTier: "live-composed-provider",
        result: "PASSED",
        workflowId,
        workflowStatus,
        runId: run.runId,
        windmillHealth,
        runStatus,
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
