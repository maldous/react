import type { AutomationRunnerPort } from "../ports/automation-runner.ts";
import type { WorkflowOrchestratorPort } from "../ports/workflow-orchestrator.ts";

export interface CombinedWorkflowDeps {
  orchestrator: WorkflowOrchestratorPort;
  automation: AutomationRunnerPort;
}

export interface CombinedWorkflowStatus {
  orchestrator: {
    provider: "temporal";
    status: "ready" | "degraded" | "not_configured";
    traces: "tempo" | "not_configured";
    logs: "loki" | "not_configured";
  };
  automation: {
    provider: "windmill";
    status: "ready" | "degraded" | "not_configured";
    traces: "tempo" | "not_configured";
    logs: "loki" | "not_configured";
  };
  ready: boolean;
}

export async function getCombinedWorkflowStatus(deps: {
  orchestratorReady: "ready" | "degraded" | "not_configured";
  automationReady: "ready" | "degraded" | "not_configured";
}): Promise<CombinedWorkflowStatus> {
  return {
    orchestrator: {
      provider: "temporal",
      status: deps.orchestratorReady,
      traces: "tempo",
      logs: "loki",
    },
    automation: {
      provider: "windmill",
      status: deps.automationReady,
      traces: "tempo",
      logs: "loki",
    },
    ready: deps.orchestratorReady === "ready" && deps.automationReady === "ready",
  };
}
