import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";
import { loadProviderReadinessConfig } from "../config/provider-readiness-config.ts";
import type { FetchLike } from "./http-engine-provider.ts";

type TemporalSdk = typeof import("@temporalio/client");

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
    const client = this.preferSdk ? await this.getClient() : null;
    if (!client) {
      return request(
        this.fetchImpl,
        `${this.baseUrl}/api/workflows/start`,
        this.operationTimeoutMs,
        {
          method: "POST",
          body: JSON.stringify(input),
        }
      );
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
    return { workflowId: handle.workflowId };
  }

  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
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
      return;
    }
    await withOperationTimeout(
      "signalWorkflow",
      this.operationTimeoutMs,
      client.getHandle(workflowId).signal(signalName, payload ?? {})
    );
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
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
      return;
    }
    await withOperationTimeout(
      "cancelWorkflow",
      this.operationTimeoutMs,
      client.getHandle(workflowId).cancel()
    );
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    const client = this.preferSdk ? await this.getClient() : null;
    if (!client) {
      return request(
        this.fetchImpl,
        `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}`,
        this.operationTimeoutMs
      );
    }
    const handle = client.getHandle(workflowId);
    const description = await withOperationTimeout(
      "getWorkflowStatus",
      this.operationTimeoutMs,
      handle.describe()
    );
    const statusName = String(description.status.name);
    const status =
      statusName === "Running"
        ? "running"
        : statusName === "Completed"
          ? "completed"
          : statusName === "Failed"
            ? "failed"
            : statusName === "Canceled"
              ? "cancelled"
              : "waiting";
    return {
      workflowId,
      status,
      detail: `temporal:${statusName}`,
    };
  }
}
