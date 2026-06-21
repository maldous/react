import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";

interface WorkflowRecord {
  tenantId: string;
  status: WorkflowStatus["status"];
  detail: string;
}

export class InMemoryWorkflowOrchestrator implements WorkflowOrchestratorPort {
  private readonly workflows = new Map<string, WorkflowRecord>();

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    this.workflows.set(input.workflowId, {
      tenantId: input.tenantId,
      status: "running",
      detail: `started:${input.workflowKey}`,
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
    if (signalName === "approval.granted") {
      record.status = "waiting";
      record.detail = payload["approvedBy"]
        ? `approved:${String(payload["approvedBy"])}`
        : "approved";
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
