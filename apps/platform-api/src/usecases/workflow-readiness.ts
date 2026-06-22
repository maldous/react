// ---------------------------------------------------------------------------
// Workflow readiness seam (v2 readiness).
//
// This is an operator-facing summary over the existing composed-provider probe.
// It surfaces only the workflow-engine providers needed for v2 migration and
// does not implement scheduling, retries, or durable execution itself.
// ---------------------------------------------------------------------------

import { getComposedProviderReadiness } from "./composed-providers.ts";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

export interface WorkflowProviderReadiness {
  provider: "windmill" | "temporal";
  status: "ready" | "degraded" | "not_configured";
  lifecycleState: "ready" | "degraded" | "configured" | "disabled" | "candidate";
  detail: string;
}

export interface WorkflowReadinessReport {
  providers: WorkflowProviderReadiness[];
  ready: boolean;
  state: "ready" | "degraded" | "failed";
  summary: string;
}

export const WORKFLOW_READINESS_STATE_MACHINE = {
  initial: "checking",
  states: ["checking", "ready", "degraded", "failed", "cancelled"] as const,
  idempotencyKey: "workflow-readiness-status",
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
  operatorRecovery: ["recoverWorkflowReadinessProbe", "retryWorkflowReadinessProbe"] as const,
};

const WORKFLOW_READINESS_TIMEOUT_MS = 5_000;
const WORKFLOW_READINESS_RETRY_ATTEMPTS = 2;
const log = createLogger({
  name: "workflow-readiness-usecase",
  service: "platform-api",
  packageName: "workflow-readiness",
  boundedContext: "workflow",
});
const tracer = createTracer("workflow-readiness");
const workflowReadinessMetrics = {
  checks: 0,
  retries: 0,
  failures: 0,
  auditEvents: 0,
  operatorRecoveries: 0,
};
const workflowReadinessAuditTrail: Array<{
  action: string;
  state: string;
  idempotencyKey: string;
}> = [];

export function getWorkflowReadinessMetric(name: keyof typeof workflowReadinessMetrics): number {
  return workflowReadinessMetrics[name];
}

export function getWorkflowReadinessAuditTrail(): readonly {
  action: string;
  state: string;
  idempotencyKey: string;
}[] {
  return workflowReadinessAuditTrail;
}

async function withTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`workflow_readiness.timeout: ${operationName}`)),
          WORKFLOW_READINESS_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retryWorkflowReadinessProbe<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WORKFLOW_READINESS_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(operation(), operationName);
    } catch (err) {
      lastError = err;
      workflowReadinessMetrics.failures += 1;
      if (attempt >= WORKFLOW_READINESS_RETRY_ATTEMPTS) break;
      workflowReadinessMetrics.retries += 1;
      log.warn({ operationName, attempt, err }, "workflow_readiness.probe.retry");
    }
  }
  throw lastError;
}

export function recoverWorkflowReadinessProbe(idempotencyKey = "workflow-readiness-status"): void {
  workflowReadinessMetrics.operatorRecoveries += 1;
  workflowReadinessAuditTrail.push({
    action: "workflow_readiness.operator_recovery",
    state: "cancelled",
    idempotencyKey,
  });
}

export async function getWorkflowReadiness(
  deps: {
    getReadiness?: typeof getComposedProviderReadiness;
  } = {}
): Promise<WorkflowReadinessReport> {
  workflowReadinessMetrics.checks += 1;
  return withSpan(
    tracer,
    "workflow-readiness.status",
    async () =>
      retryWorkflowReadinessProbe("workflow-readiness.status", async () => {
        const composed = await (deps.getReadiness ?? getComposedProviderReadiness)();
        const providers = composed.providers
          .filter((p) => p.provider === "windmill" || p.provider === "temporal")
          .map((p) => ({
            provider: p.provider as "windmill" | "temporal",
            status: p.status,
            lifecycleState: p.lifecycleState,
            detail: p.detail,
          }));
        const ready =
          providers.some((p) => p.provider === "windmill" && p.status === "ready") &&
          providers.some((p) => p.provider === "temporal" && p.status === "ready");
        const state = ready
          ? "ready"
          : providers.some((p) => p.status === "degraded")
            ? "degraded"
            : "failed";
        workflowReadinessMetrics.auditEvents += 1;
        workflowReadinessAuditTrail.push({
          action: "workflow_readiness.status_checked",
          state,
          idempotencyKey: WORKFLOW_READINESS_STATE_MACHINE.idempotencyKey,
        });
        log.info({ state, ready }, "workflow_readiness.status.checked");
        return {
          providers,
          ready,
          state,
          summary: ready
            ? "Windmill and Temporal are both available for workflow orchestration."
            : "One or both workflow engines are not yet ready.",
        };
      }),
    { "workflow.readiness_idempotency_key": WORKFLOW_READINESS_STATE_MACHINE.idempotencyKey }
  );
}
