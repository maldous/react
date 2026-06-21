import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryWorkflowOrchestrator } from "../../src/adapters/in-memory-workflow-orchestrator.ts";

describe("InMemoryWorkflowOrchestrator approval transitions", () => {
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
});
