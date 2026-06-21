import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";

interface WorkflowRecord {
  tenantId: string;
  status: WorkflowStatus["status"];
  detail: string;
  payload: Record<string, unknown>;
}

export class InMemoryWorkflowOrchestrator implements WorkflowOrchestratorPort {
  private readonly workflows = new Map<string, WorkflowRecord>();

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    this.workflows.set(input.workflowId, {
      tenantId: input.tenantId,
      status: "running",
      detail: `started:${input.workflowKey}`,
      payload: { ...input.payload, workflowKey: input.workflowKey },
    });
    return { workflowId: input.workflowId };
  }

  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    const record = this.workflows.get(workflowId);
    if (!record) throw new Error("workflow_not_found");
    if (signalName === "approval.requested") {
      record.status = "waiting";
      record.detail = payload["requestedBy"]
        ? `approval_requested:${String(payload["requestedBy"])}`
        : "approval_requested";
      record.payload = { ...record.payload, approvalRequested: payload };
      return;
    }
    if (signalName === "approval.granted") {
      record.status = "completed";
      record.detail = payload["approvedBy"]
        ? `approved:${String(payload["approvedBy"])}`
        : "approved";
      record.payload = { ...record.payload, approvalGranted: payload };
      return;
    }
    if (signalName === "approval.denied") {
      record.status = "failed";
      record.detail = payload["deniedBy"] ? `denied:${String(payload["deniedBy"])}` : "denied";
      record.payload = { ...record.payload, approvalDenied: payload };
    }
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const record = this.workflows.get(workflowId);
    if (!record) throw new Error("workflow_not_found");
    record.status = "cancelled";
    record.detail = "cancelled";
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    const record = this.workflows.get(workflowId);
    if (!record) throw new Error("workflow_not_found");
    return { workflowId, status: record.status, detail: record.detail };
  }

  canAccess(workflowId: string, tenantId: string): boolean {
    return this.workflows.get(workflowId)?.tenantId === tenantId;
  }
}
