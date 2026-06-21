import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";
import type { FetchLike } from "./http-engine-provider.ts";

type WindmillClientModule = typeof import("windmill-client");

export class WindmillAutomationProviderAdapter implements AutomationRunnerPort {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly preferSdk: boolean;
  private clientPromise: Promise<WindmillClientModule | null> | null = null;
  private readonly workspaceByRunId = new Map<string, string>();

  constructor(
    baseUrl: string,
    fetchImpl: FetchLike = fetch,
    options?: { token?: string; preferSdk?: boolean }
  ) {
    this.baseUrl = baseUrl;
    this.token = options?.token;
    this.fetchImpl = fetchImpl;
    this.preferSdk = options?.preferSdk ?? true;
  }

  private async loadClient(): Promise<WindmillClientModule | null> {
    if (!this.preferSdk) return null;
    if (!this.clientPromise) {
      this.clientPromise = import("windmill-client")
        .then((client) => {
          client.setClient(this.token, this.baseUrl);
          return client;
        })
        .catch(() => null);
    }
    return this.clientPromise;
  }

  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    const client = await this.loadClient();
    if (client) {
      const runId = await client.JobService.runScriptByPath({
        workspace: input.tenantId,
        path: input.scriptKey,
        requestBody: input.payload ?? {},
        jobId: input.runId,
      });
      const id = String(runId);
      this.workspaceByRunId.set(id, input.tenantId);
      return { runId: id };
    }

    const { json } = await import("./http-engine-provider.ts");
    return json<{ runId: string }>(this.fetchImpl, `${this.baseUrl}/api/run-script`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    const client = await this.loadClient();
    if (client) {
      const runId = await client.JobService.runFlowByPath({
        workspace: input.tenantId,
        path: input.scriptKey,
        requestBody: input.payload ?? {},
        jobId: input.runId,
      });
      const id = String(runId);
      this.workspaceByRunId.set(id, input.tenantId);
      return { runId: id };
    }

    const { json } = await import("./http-engine-provider.ts");
    return json<{ runId: string }>(this.fetchImpl, `${this.baseUrl}/api/run-flow`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    const client = await this.loadClient();
    if (client) {
      const job = await client.JobService.getJob({
        workspace: this.workspaceByRunId.get(runId) ?? "default",
        id: runId,
      });
      const status = String((job as { status?: string }).status ?? "unknown");
      return { runId, status: this.normalizeStatus(status), detail: status };
    }

    const { json } = await import("./http-engine-provider.ts");
    return json<AutomationRunStatus>(
      this.fetchImpl,
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}`
    );
  }

  async cancelRun(runId: string): Promise<void> {
    const client = await this.loadClient();
    if (client) {
      await client.JobService.cancelQueuedJob({
        workspace: this.workspaceByRunId.get(runId) ?? "default",
        id: runId,
        requestBody: { reason: "canceled by platform-api" },
      });
      return;
    }

    const { json } = await import("./http-engine-provider.ts");
    await json(this.fetchImpl, `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
  }

  private normalizeStatus(status: string): AutomationRunStatus["status"] {
    const value = status.toLowerCase();
    if (value.includes("success") || value.includes("succeed") || value.includes("done")) {
      return "succeeded";
    }
    if (value.includes("cancel")) return "cancelled";
    if (value.includes("fail") || value.includes("error")) return "failed";
    if (value.includes("run") || value.includes("start") || value.includes("queue")) {
      return "running";
    }
    return "queued";
  }
}
