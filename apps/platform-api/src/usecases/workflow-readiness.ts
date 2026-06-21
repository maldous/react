// ---------------------------------------------------------------------------
// Workflow readiness seam (v2 readiness).
//
// This is an operator-facing summary over the existing composed-provider probe.
// It surfaces only the workflow-engine providers needed for v2 migration and
// does not implement scheduling, retries, or durable execution itself.
// ---------------------------------------------------------------------------

import { getComposedProviderReadiness } from "./composed-providers.ts";

export interface WorkflowProviderReadiness {
  provider: "windmill" | "temporal";
  status: "ready" | "degraded" | "not_configured";
  lifecycleState: "ready" | "degraded" | "configured" | "disabled" | "candidate";
  detail: string;
}

export interface WorkflowReadinessReport {
  providers: WorkflowProviderReadiness[];
  ready: boolean;
  summary: string;
}

export async function getWorkflowReadiness(): Promise<WorkflowReadinessReport> {
  const composed = await getComposedProviderReadiness();
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
  return {
    providers,
    ready,
    summary: ready
      ? "Windmill and Temporal are both available for workflow orchestration."
      : "One or both workflow engines are not yet ready.",
  };
}
