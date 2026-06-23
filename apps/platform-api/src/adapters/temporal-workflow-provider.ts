import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";
import { loadProviderReadinessConfig } from "../config/provider-readiness-config.ts";
import type { FetchLike } from "./http-engine-provider.ts";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

type TemporalSdk = typeof import("@temporalio/client");
type WorkflowAuditRecord = {
  workflowId: string;
  action: string;
  transition: string;
  at: string;
};

const log = createLogger({
  name: "temporal-workflow-provider",
  service: "platform-api",
  boundedContext: "workflow",
});
const tracer = createTracer("temporal-workflow-provider");
const temporalWorkflowMetrics = new Map<string, number>();

function metric(operation: string, outcome: "success" | "error"): void {
  const key = `${operation}:${outcome}`;
  temporalWorkflowMetrics.set(key, (temporalWorkflowMetrics.get(key) ?? 0) + 1);
}

export function getTemporalWorkflowProviderMetric(
  operation: string,
  outcome: "success" | "error"
): number {
  return temporalWorkflowMetrics.get(`${operation}:${outcome}`) ?? 0;
}

export const temporalWorkflowStateMachineEvidence = {
  stateMachineDefinition:
    "Temporal is provider-authoritative; V1 maps provider status to running|waiting|completed|failed|cancelled",
  allowedTransitions:
    "allowed transition operations are startWorkflow, signalWorkflow, cancelWorkflow, and getWorkflowStatus; provider rejects invalid workflow transitions",
  forbiddenTransitions:
    "forbidden transitions are rejected by Temporal or the HTTP workflow API and surface as errors instead of local success",
  idempotency:
    "workflowId is supplied to Temporal start and the HTTP API so duplicate starts are idempotency-keyed by provider workflowId",
  audit: "adapter records local audit entries for start, signal, cancel, and status observations",
};

export const temporalWorkflowProviderReliabilityEvidence = {
  secretSource:
    "Temporal workflow provider does not accept a token or apiKey; deployments that require mTLS/credentials terminate them in the Temporal client configuration outside this adapter",
  timeout:
    "SDK and HTTP workflow operations are bounded by operationTimeoutMs through withOperationTimeout",
  retry:
    "no retry inside the adapter: workflow start/signal/cancel are single provider attempts keyed by workflowId and retried by the caller/workflow policy when safe",
  degradedMode:
    "when the Temporal SDK is unavailable the adapter degrades to the configured HTTP workflow API; provider failures surface as errors instead of fake success",
  fallbackRationale:
    "HTTP fallback exists only for the local composed provider API; there is no in-memory fallback because workflow state must remain provider-authoritative",
  operatorRecovery:
    "operators recover by restoring Temporal reachability, namespace/task-queue configuration, and rerunning workflow-provider-live proof",
};

function timeoutError(operation: string): Error {
  return new Error(`temporal_workflow_provider_timeout:${operation}`);
}

async function withOperationTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(operation)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function request<T>(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

async function loadTemporalSdk(): Promise<TemporalSdk | null> {
  try {
    return await import("@temporalio/client");
  } catch {
    return null;
  }
}

export class TemporalWorkflowProviderAdapter implements WorkflowOrchestratorPort {
  private readonly baseUrl: string;
  private readonly namespace: string;
  private readonly fetchImpl: FetchLike;
  private readonly preferSdk: boolean;
  private readonly operationTimeoutMs: number;
  private sdkPromise: Promise<TemporalSdk | null> | null = null;
  private readonly auditEvents: WorkflowAuditRecord[] = [];

  constructor(
    baseUrl: string,
    opts: {
      namespace?: string;
      fetchImpl?: FetchLike;
      preferSdk?: boolean;
      operationTimeoutMs?: number;
    } = {}
  ) {
    const providerConfig = loadProviderReadinessConfig();
    this.baseUrl = baseUrl;
    this.namespace = opts.namespace ?? providerConfig.temporalNamespace?.trim() ?? "default";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.preferSdk = opts.preferSdk ?? true;
    this.operationTimeoutMs = opts.operationTimeoutMs ?? 5000;
  }

  private async sdk(): Promise<TemporalSdk | null> {
    this.sdkPromise ??= loadTemporalSdk();
    return this.sdkPromise;
  }

  private async getClient() {
    const sdk = await this.sdk();
    if (!sdk) return null;
    const address = this.baseUrl.replace(/^https?:\/\//, "");
    const connection = await withOperationTimeout(
      "connect",
      this.operationTimeoutMs,
      sdk.Connection.connect({
        address,
      })
    );
    return new sdk.WorkflowClient({
      connection,
      namespace: this.namespace,
    });
  }

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return this.withWorkflowOperation("start", input.workflowId, async () => {
      const client = this.preferSdk ? await this.getClient() : null;
      if (!client) {
        const result = await request<{ workflowId: string }>(
          this.fetchImpl,
          `${this.baseUrl}/api/workflows/start`,
          this.operationTimeoutMs,
          {
            method: "POST",
            body: JSON.stringify(input),
          }
        );
        this.recordAudit(result.workflowId, "workflow.started", "none->running");
        return result;
      }
      const handle = await withOperationTimeout(
        "startWorkflow",
        this.operationTimeoutMs,
        client.start(input.workflowKey, {
          taskQueue: input.workflowKey,
          workflowId: input.workflowId,
          args: [input.payload],
          searchAttributes: {
            TenantId: [input.tenantId],
          },
        })
      );
      this.recordAudit(handle.workflowId, "workflow.started", "none->running");
      return { workflowId: handle.workflowId };
    });
  }

  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    return this.withWorkflowOperation("signal", workflowId, async () => {
      const client = this.preferSdk ? await this.getClient() : null;
      if (!client) {
        await request(
          this.fetchImpl,
          `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/signal`,
          this.operationTimeoutMs,
          {
            method: "POST",
            body: JSON.stringify({ signalName, payload }),
          }
        );
        this.recordAudit(workflowId, `workflow.signal.${signalName}`, "provider-authoritative");
        return;
      }
      await withOperationTimeout(
        "signalWorkflow",
        this.operationTimeoutMs,
        client.getHandle(workflowId).signal(signalName, payload ?? {})
      );
      this.recordAudit(workflowId, `workflow.signal.${signalName}`, "provider-authoritative");
    });
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    return this.withWorkflowOperation("cancel", workflowId, async () => {
      const client = this.preferSdk ? await this.getClient() : null;
      if (!client) {
        await request(
          this.fetchImpl,
          `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/cancel`,
          this.operationTimeoutMs,
          {
            method: "POST",
          }
        );
        this.recordAudit(workflowId, "workflow.cancelled", "provider-state->cancelled");
        return;
      }
      await withOperationTimeout(
        "cancelWorkflow",
        this.operationTimeoutMs,
        client.getHandle(workflowId).cancel()
      );
      this.recordAudit(workflowId, "workflow.cancelled", "provider-state->cancelled");
    });
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    return this.withWorkflowOperation("status", workflowId, async () => {
      const client = this.preferSdk ? await this.getClient() : null;
      if (!client) {
        const status = await request<WorkflowStatus>(
          this.fetchImpl,
          `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}`,
          this.operationTimeoutMs
        );
        this.recordAudit(workflowId, "workflow.status_observed", `provider->${status.status}`);
        return status;
      }
      const handle = client.getHandle(workflowId);
      const description = await withOperationTimeout(
        "getWorkflowStatus",
        this.operationTimeoutMs,
        handle.describe()
      );
      const statusName = String(description.status.name);
      const normalizedStatusName = statusName.toLowerCase();
      const status =
        normalizedStatusName === "running" ||
        normalizedStatusName === "workflow_execution_status_running"
          ? "running"
          : normalizedStatusName === "completed" ||
              normalizedStatusName === "workflow_execution_status_completed"
            ? "completed"
            : normalizedStatusName === "failed" ||
                normalizedStatusName === "workflow_execution_status_failed"
              ? "failed"
              : normalizedStatusName === "canceled" ||
                  normalizedStatusName === "cancelled" ||
                  normalizedStatusName === "workflow_execution_status_canceled"
                ? "cancelled"
                : "waiting";
      this.recordAudit(workflowId, "workflow.status_observed", `provider->${status}`);
      return {
        workflowId,
        status,
        detail: `temporal:${statusName}`,
      };
    });
  }

  getAuditEvents(): WorkflowAuditRecord[] {
    return [...this.auditEvents];
  }

  private recordAudit(workflowId: string, action: string, transition: string): void {
    this.auditEvents.push({ workflowId, action, transition, at: new Date().toISOString() });
  }

  private async withWorkflowOperation<T>(
    operation: string,
    workflowId: string,
    run: () => Promise<T>
  ): Promise<T> {
    return withSpan(
      tracer,
      `temporal-workflow-provider.${operation}`,
      async () => {
        try {
          const result = await run();
          metric(operation, "success");
          log.info({ operation, workflowId }, "temporal_workflow.operation.complete");
          return result;
        } catch (err) {
          metric(operation, "error");
          log.error({ err, operation, workflowId }, "temporal_workflow.operation.failed");
          throw err;
        }
      },
      { "workflow.operation": operation, "workflow.id": workflowId }
    );
  }
}
