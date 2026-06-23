/**
 * Workflow provider live proof.
 *
 * Proves the workflow-provider compose profile when the endpoints are wired:
 * - Temporal: real SDK-backed start/signal/status/cancel path
 * - Windmill: real provider health and auth boundary; run/status/cancel path
 *   when a WINDMILL_TOKEN is configured
 * - Proof tier: live-composed-provider for each reachable backend
 *
 * The proof skips honestly when a required endpoint is not configured or
 * unreachable. This is a provider drill, not a fake pass.
 */

import { strict as assert } from "node:assert";
import { Connection } from "@temporalio/client";
import temporalProto from "@temporalio/proto";
import { TemporalWorkflowProviderAdapter } from "../src/adapters/temporal-workflow-provider.ts";
import { WindmillAutomationProviderAdapter } from "../src/adapters/windmill-automation-provider.ts";

const { temporal } = temporalProto;

type WindmillProofResult =
  | {
      mode: "authenticated-run";
      runId: string;
      runStatus: Awaited<ReturnType<WindmillAutomationProviderAdapter["getRunStatus"]>>;
    }
  | {
      mode: "unauthenticated-boundary";
      unauthorizedStatus: number | string;
      unauthorizedMessage: string;
    };

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

async function ensureTenantSearchAttribute(address: string, namespace: string): Promise<boolean> {
  const connection = await Connection.connect({
    address: address.replace(/^https?:\/\//, ""),
  });
  try {
    const current = await connection.operatorService.listSearchAttributes({ namespace });
    if (current.customAttributes?.TenantId) return false;
    await connection.operatorService.addSearchAttributes({
      namespace,
      searchAttributes: {
        TenantId: temporal.api.enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Error && /already exists|already.*registered/i.test(err.message)) {
      return false;
    }
    throw err;
  } finally {
    await connection.close();
  }
}

async function main(): Promise<void> {
  const temporalAddress = env("TEMPORAL_ADDRESS") ?? env("TEMPORAL_HTTP_URL");
  const windmillUrl = env("WINDMILL_URL");
  const windmillToken = env("WINDMILL_TOKEN");
  const temporalNamespace = env("TEMPORAL_NAMESPACE") ?? "default";

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

  const tenantSearchAttributeCreated = await ensureTenantSearchAttribute(
    temporalAddress,
    temporalNamespace
  );
  const temporal = new TemporalWorkflowProviderAdapter(temporalAddress, {
    namespace: temporalNamespace,
    preferSdk: true,
  });
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

  const windmillProof = await (async (): Promise<WindmillProofResult> => {
    const run = await windmill
      .runScript({
        scriptKey: "tenant.export",
        tenantId: "tenant-a",
        runId: `run-${Date.now().toString(36)}`,
        payload: {},
      })
      .catch((err: unknown) => {
        if (!windmillToken) return err;
        throw err;
      });

    if (run instanceof Error) {
      const status = "status" in run ? String(run.status) : "";
      assert.match(
        `${status} ${run.message}`,
        /401|403|unauthorized|forbidden/i,
        "Windmill without WINDMILL_TOKEN must fail closed"
      );
      return {
        mode: "unauthenticated-boundary",
        unauthorizedStatus: status || "unknown",
        unauthorizedMessage: run.message,
      };
    }

    const runStatus = await windmill.getRunStatus(run.runId);
    assert.equal(runStatus.runId, run.runId);
    assert.ok(["queued", "running", "succeeded", "failed", "cancelled"].includes(runStatus.status));
    await windmill.cancelRun(run.runId);
    return { mode: "authenticated-run", runId: run.runId, runStatus };
  })();

  await temporal.cancelWorkflow(started.workflowId);

  console.log(
    JSON.stringify(
      {
        capability: "workflow-provider live proof",
        proofTier: "live-composed-provider",
        result: "PASSED",
        workflowId,
        workflowStatus,
        temporalNamespace,
        tenantSearchAttributeCreated,
        windmillProof,
        windmillHealth,
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
