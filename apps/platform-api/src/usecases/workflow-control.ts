import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
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
  state: "ready" | "degraded" | "failed";
}

export const WORKFLOW_CONTROL_STATE_MACHINE = {
  initial: "checking",
  states: ["checking", "ready", "degraded", "failed", "cancelled"] as const,
  idempotencyKey: "workflow-control-status",
  allowedTransitions: [
    ["checking", "ready"],
    ["checking", "degraded"],
    ["checking", "failed"],
    ["degraded", "ready"],
    ["degraded", "cancelled"],
  ] as const,
  forbiddenTransitions: [
    ["ready", "checking"],
    ["failed", "ready"],
    ["cancelled", "ready"],
  ] as const,
  operatorRecovery: ["recoverWorkflowControlProbe", "retryWorkflowControlProbe"] as const,
};

const WORKFLOW_CONTROL_TIMEOUT_MS = 5_000;
const WORKFLOW_CONTROL_RETRY_ATTEMPTS = 2;
const log = createLogger({
  name: "workflow-control-usecase",
  service: "platform-api",
  packageName: "workflow-control",
  boundedContext: "workflow",
});
const tracer = createTracer("workflow-control");
const workflowControlMetrics = {
  checks: 0,
  retries: 0,
  failures: 0,
  auditEvents: 0,
  operatorRecoveries: 0,
};
const workflowControlAuditTrail: Array<{ action: string; state: string; idempotencyKey: string }> =
  [];

export function getWorkflowControlMetric(name: keyof typeof workflowControlMetrics): number {
  return workflowControlMetrics[name];
}

export function getWorkflowControlAuditTrail(): readonly {
  action: string;
  state: string;
  idempotencyKey: string;
}[] {
  return workflowControlAuditTrail;
}

async function withTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`workflow_control.timeout: ${operationName}`)),
          WORKFLOW_CONTROL_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retryWorkflowControlProbe<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WORKFLOW_CONTROL_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(operation(), operationName);
    } catch (err) {
      lastError = err;
      workflowControlMetrics.failures += 1;
      if (attempt >= WORKFLOW_CONTROL_RETRY_ATTEMPTS) break;
      workflowControlMetrics.retries += 1;
      log.warn({ operationName, attempt, err }, "workflow_control.probe.retry");
    }
  }
  throw lastError;
}

export function recoverWorkflowControlProbe(idempotencyKey = "workflow-control-status"): void {
  workflowControlMetrics.operatorRecoveries += 1;
  workflowControlAuditTrail.push({
    action: "workflow_control.operator_recovery",
    state: "cancelled",
    idempotencyKey,
  });
}

export async function getCombinedWorkflowStatus(deps: {
  orchestratorReady: "ready" | "degraded" | "not_configured";
  automationReady: "ready" | "degraded" | "not_configured";
}): Promise<CombinedWorkflowStatus> {
  workflowControlMetrics.checks += 1;
  return withSpan(
    tracer,
    "workflow-control.status",
    async () =>
      retryWorkflowControlProbe("workflow-control.status", async () => {
        const ready = deps.orchestratorReady === "ready" && deps.automationReady === "ready";
        const state = ready
          ? "ready"
          : deps.orchestratorReady === "not_configured" || deps.automationReady === "not_configured"
            ? "failed"
            : "degraded";
        workflowControlMetrics.auditEvents += 1;
        workflowControlAuditTrail.push({
          action: "workflow_control.status_checked",
          state,
          idempotencyKey: WORKFLOW_CONTROL_STATE_MACHINE.idempotencyKey,
        });
        log.info({ state, ready }, "workflow_control.status.checked");
        return {
          orchestrator: {
            provider: "temporal" as const,
            status: deps.orchestratorReady,
            traces: "tempo" as const,
            logs: "loki" as const,
          },
          automation: {
            provider: "windmill" as const,
            status: deps.automationReady,
            traces: "tempo" as const,
            logs: "loki" as const,
          },
          ready,
          state,
        };
      }),
    { "workflow.control_idempotency_key": WORKFLOW_CONTROL_STATE_MACHINE.idempotencyKey }
  );
}
