// ---------------------------------------------------------------------------
// Automation runner port.
//
// Windmill owns scripts and operator automation. This port isolates short-lived
// operator jobs, data repair tools and import/export helpers from durable business
// workflows.
// ---------------------------------------------------------------------------

export interface AutomationRunInput {
  scriptKey: string;
  tenantId: string;
  runId: string;
  payload: Record<string, unknown>;
}

export interface AutomationRunStatus {
  runId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  detail: string;
}

export interface AutomationRunnerPort {
  runScript(input: AutomationRunInput): Promise<{ runId: string }>;
  runFlow(input: AutomationRunInput): Promise<{ runId: string }>;
  getRunStatus(runId: string): Promise<AutomationRunStatus>;
  cancelRun(runId: string): Promise<void>;
}
