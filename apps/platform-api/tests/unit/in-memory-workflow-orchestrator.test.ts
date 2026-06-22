import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryWorkflowOrchestrator,
  loadInMemoryWorkflowOrchestratorConfig,
} from "../../src/adapters/in-memory-workflow-orchestrator.ts";

describe("InMemoryWorkflowOrchestrator approval transitions", () => {
  it("loads provider reliability config from explicit environment sources", () => {
    const config = loadInMemoryWorkflowOrchestratorConfig({
      IN_MEMORY_WORKFLOW_ORCHESTRATOR_TIMEOUT_MS: "123",
      IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_ATTEMPTS: "2",
      IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_BACKOFF_MS: "4",
    });

    assert.equal(config.enabled, true);
    assert.equal(config.operationTimeoutMs, 123);
    assert.equal(config.retryAttempts, 2);
    assert.equal(config.retryBackoffMs, 4);
    assert.match(config.configSource, /process\.env/);
    assert.match(config.secretSource, /no secret/i);
    assert.match(config.fallbackRationale, /no fallback|fail closed/i);
  });

  it("tracks approval requested, granted and denied transitions", async () => {
    const orch = new InMemoryWorkflowOrchestrator();

    await orch.startWorkflow({
      workflowKey: "support.approval",
      tenantId: "tenant-a",
      workflowId: "wf-support-1",
      payload: { supportAccessReason: "investigation" },
    });

    assert.deepEqual(await orch.getWorkflowStatus("wf-support-1"), {
      workflowId: "wf-support-1",
      status: "running",
      detail: "started:support.approval",
    });

    await orch.signalWorkflow("wf-support-1", "approval.requested", {
      requestedBy: "user-1",
    });
    assert.deepEqual(await orch.getWorkflowStatus("wf-support-1"), {
      workflowId: "wf-support-1",
      status: "waiting",
      detail: "approval_requested:user-1",
    });

    await orch.signalWorkflow("wf-support-1", "approval.granted", {
      approvedBy: "user-2",
    });
    assert.deepEqual(await orch.getWorkflowStatus("wf-support-1"), {
      workflowId: "wf-support-1",
      status: "completed",
      detail: "approved:user-2",
    });

    await orch.startWorkflow({
      workflowKey: "support.approval",
      tenantId: "tenant-a",
      workflowId: "wf-support-2",
      payload: {},
    });
    await orch.signalWorkflow("wf-support-2", "approval.denied", {
      deniedBy: "user-3",
    });
    assert.deepEqual(await orch.getWorkflowStatus("wf-support-2"), {
      workflowId: "wf-support-2",
      status: "failed",
      detail: "denied:user-3",
    });
  });

  it("enforces tenant access, cancellation and health state", async () => {
    const orch = new InMemoryWorkflowOrchestrator();

    await orch.startWorkflow({
      workflowKey: "support.approval",
      tenantId: "tenant-a",
      workflowId: "wf-support-tenant",
      payload: {},
    });

    assert.equal(orch.canAccess("wf-support-tenant", "tenant-a"), true);
    assert.equal(orch.canAccess("wf-support-tenant", "tenant-b"), false);

    const health = await orch.healthCheck();
    assert.equal(health.ok, true);
    assert.equal(health.ok && health.workflowCount, 1);

    await orch.cancelWorkflow("wf-support-tenant");
    assert.deepEqual(await orch.getWorkflowStatus("wf-support-tenant"), {
      workflowId: "wf-support-tenant",
      status: "cancelled",
      detail: "cancelled",
    });
  });

  it("fails closed on unsupported signals and unavailable provider state", async () => {
    const orch = new InMemoryWorkflowOrchestrator();

    await orch.startWorkflow({
      workflowKey: "support.approval",
      tenantId: "tenant-a",
      workflowId: "wf-support-unsupported",
      payload: {},
    });

    await assert.rejects(
      () => orch.signalWorkflow("wf-support-unsupported", "approval.escalated", {}),
      /unsupported_workflow_signal/
    );

    const disabled = new InMemoryWorkflowOrchestrator({
      ...loadInMemoryWorkflowOrchestratorConfig({}),
      enabled: false,
    });
    await assert.rejects(
      () =>
        disabled.startWorkflow({
          workflowKey: "support.approval",
          tenantId: "tenant-a",
          workflowId: "wf-disabled",
          payload: {},
        }),
      /fail closed/i
    );
    assert.throws(() => disabled.canAccess("wf-disabled", "tenant-a"), /fail closed/i);
    assert.equal((await disabled.healthCheck()).ok, false);
    assert.match(disabled.recoveryAction(), /operator recovery|repair|retry/i);
  });
});
