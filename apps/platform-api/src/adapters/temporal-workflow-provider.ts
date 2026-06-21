import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";
import type { FetchLike } from "./http-engine-provider.ts";

async function request<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

export class TemporalWorkflowProviderAdapter implements WorkflowOrchestratorPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return request(this.fetchImpl, `${this.baseUrl}/api/workflows/start`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    await request(
      this.fetchImpl,
      `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/signal`,
      {
        method: "POST",
        body: JSON.stringify({ signalName, payload }),
      }
    );
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    await request(
      this.fetchImpl,
      `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}/cancel`,
      {
        method: "POST",
      }
    );
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    return request(
      this.fetchImpl,
      `${this.baseUrl}/api/workflows/${encodeURIComponent(workflowId)}`
    );
  }
}
