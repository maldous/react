import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";
import { loadProviderReadinessConfig } from "../config/provider-readiness-config.ts";
import type { FetchLike } from "./http-engine-provider.ts";

type TemporalSdk = typeof import("@temporalio/client");

async function request<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
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
  private sdkPromise: Promise<TemporalSdk | null> | null = null;

  constructor(
    baseUrl: string,
    opts: { namespace?: string; fetchImpl?: FetchLike; preferSdk?: boolean } = {}
  ) {
    const providerConfig = loadProviderReadinessConfig();
    this.baseUrl = baseUrl;
    this.namespace = opts.namespace ?? providerConfig.temporalNamespace?.trim() ?? "default";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.preferSdk = opts.preferSdk ?? true;
  }

  private async sdk(): Promise<TemporalSdk | null> {
    this.sdkPromise ??= loadTemporalSdk();
    return this.sdkPromise;
  }

  private async getClient() {
    const sdk = await this.sdk();
    if (!sdk) return null;
    const address = this.baseUrl.replace(/^https?:\/\//, "");
    const connection = await sdk.Connection.connect({
      address,
    });
    return new sdk.WorkflowClient({
      connection,
      namespace: this.namespace,
    });
  }

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    const client = this.preferSdk ? await this.getClient() : null;
    if (!client) {
      return request(this.fetchImpl, `${this.baseUrl}/api/workflows/start`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    }
    const handle = await client.start(input.workflowKey, {
      taskQueue: input.workflowKey,
      workflowId: input.workflowId,
      args: [input.payload],
      searchAttributes: {
        TenantId: [input.tenantId],
      },
    });
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
        {
          method: "POST",
          body: JSON.stringify({ signalName, payload }),
        }
      );
      return;
    }
    await client.getHandle(workflowId).signal(signalName, payload ?? {});
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const client = this.preferSdk ? await this.getClient() : null;
    if (!client) {
      await request(
        this.fetchImpl,
        `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/cancel`,
        {
          method: "POST",
        }
      );
      return;
    }
    await client.getHandle(workflowId).cancel();
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    const client = this.preferSdk ? await this.getClient() : null;
    if (!client) {
      return request(
        this.fetchImpl,
        `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}`
      );
    }
    const handle = client.getHandle(workflowId);
    const description = await handle.describe();
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
