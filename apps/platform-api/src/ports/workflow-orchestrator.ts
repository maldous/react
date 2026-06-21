// ---------------------------------------------------------------------------
// Workflow orchestration port.
//
// Temporal is the durable business-process engine. The platform API remains the
// authority for tenant identity, authorization and audit. This port is the only
// allowed seam from platform code into durable workflow execution.
// ---------------------------------------------------------------------------

export interface WorkflowStartInput {
  workflowKey: string;
  tenantId: string;
  workflowId: string;
  payload: Record<string, unknown>;
}

export interface WorkflowStatus {
  workflowId: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  detail: string;
}

export interface WorkflowOrchestratorPort {
  startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }>;
  signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void>;
  cancelWorkflow(workflowId: string): Promise<void>;
  getWorkflowStatus(workflowId: string): Promise<WorkflowStatus>;
}
