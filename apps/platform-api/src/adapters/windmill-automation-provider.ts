import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";
import type { FetchLike } from "./http-engine-provider.ts";

type WindmillClientModule = typeof import("windmill-client");

export const windmillAutomationProviderReliabilityEvidence = {
  provider: "windmill-automation-provider",
  configSource:
    "baseUrl/token are injected from loadProviderReadinessConfig/process.env before adapter construction",
  secretSource:
    "optional WINDMILL_TOKEN credential is caller supplied; this adapter stores it only in memory for SDK client setup",
  timeout:
    "SDK and HTTP operations are bounded by timeoutMs; HTTP fallback passes timeoutMs to the shared AbortSignal.timeout JSON helper",
  retry:
    "no retry inside the adapter: script run, flow run, status lookup, and cancel are single Windmill provider attempts",
  degradedMode:
    "SDK import/setup failure degrades to the HTTP provider API; HTTP provider failures surface as errors rather than fabricated runs",
  failClosed:
    "non-OK HTTP responses throw via json(), unavailable providers throw, and unknown provider statuses normalize to queued rather than success",
  fallbackRationale:
    "fallback is limited to SDK-to-HTTP for the same configured Windmill endpoint; there is no alternate automation provider fallback",
  healthCheck:
    "healthCheck probes Windmill HealthService when SDK is available or /api/health through the bounded HTTP path",
  operatorRecovery:
    "operators recover by repairing WINDMILL_URL/WINDMILL_TOKEN, checking health, and rerunning idempotent automation jobs by runId",
  unavailableProof: "apps/platform-api/scripts/windmill-automation-provider-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/scripts/windmill-automation-provider-runtime-proof.ts",
} as const;

const DEFAULT_WINDMILL_TIMEOUT_MS = 5000;

async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`windmill_timeout:${operation}`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class WindmillAutomationProviderAdapter implements AutomationRunnerPort {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly preferSdk: boolean;
  private readonly timeoutMs: number;
  private clientPromise: Promise<WindmillClientModule | null> | null = null;
  private readonly workspaceByRunId = new Map<string, string>();

  constructor(
    baseUrl: string,
    fetchImpl: FetchLike = fetch,
    options?: { token?: string; preferSdk?: boolean; timeoutMs?: number }
  ) {
    this.baseUrl = baseUrl;
    this.token = options?.token;
    this.fetchImpl = fetchImpl;
    this.preferSdk = options?.preferSdk ?? true;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_WINDMILL_TIMEOUT_MS;
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
      const runId = await withTimeout(
        "runScript",
        this.timeoutMs,
        client.JobService.runScriptByPath({
          workspace: input.tenantId,
          path: input.scriptKey,
          requestBody: input.payload ?? {},
          jobId: input.runId,
        })
      );
      const id = String(runId);
      this.workspaceByRunId.set(id, input.tenantId);
      return { runId: id };
    }

    const { json } = await import("./http-engine-provider.ts");
    return json<{ runId: string }>(
      this.fetchImpl,
      `${this.baseUrl}/api/run-script`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    const client = await this.loadClient();
    if (client) {
      const runId = await withTimeout(
        "runFlow",
        this.timeoutMs,
        client.JobService.runFlowByPath({
          workspace: input.tenantId,
          path: input.scriptKey,
          requestBody: input.payload ?? {},
          jobId: input.runId,
        })
      );
      const id = String(runId);
      this.workspaceByRunId.set(id, input.tenantId);
      return { runId: id };
    }

    const { json } = await import("./http-engine-provider.ts");
    return json<{ runId: string }>(
      this.fetchImpl,
      `${this.baseUrl}/api/run-flow`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    const client = await this.loadClient();
    if (client) {
      const job = await withTimeout(
        "getRunStatus",
        this.timeoutMs,
        client.JobService.getJob({
          workspace: this.workspaceByRunId.get(runId) ?? "default",
          id: runId,
        })
      );
      const status = String((job as { status?: string }).status ?? "unknown");
      return { runId, status: this.normalizeStatus(status), detail: status };
    }

    const { json } = await import("./http-engine-provider.ts");
    return json<AutomationRunStatus>(
      this.fetchImpl,
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}`,
      undefined,
      this.timeoutMs
    );
  }

  async cancelRun(runId: string): Promise<void> {
    const client = await this.loadClient();
    if (client) {
      await withTimeout(
        "cancelRun",
        this.timeoutMs,
        client.JobService.cancelQueuedJob({
          workspace: this.workspaceByRunId.get(runId) ?? "default",
          id: runId,
          requestBody: { reason: "canceled by platform-api" },
        })
      );
      return;
    }

    const { json } = await import("./http-engine-provider.ts");
    await json(
      this.fetchImpl,
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ runId }),
      },
      this.timeoutMs
    );
  }

  async healthCheck(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    const client = await this.loadClient();
    if (client && "HealthService" in client) {
      try {
        await withTimeout(
          "healthCheck",
          this.timeoutMs,
          client.HealthService.getHealthStatus({ force: true })
        );
        return { status: "ready", detail: "windmill:sdk:ok" };
      } catch (err) {
        return { status: "degraded", detail: `windmill:sdk:${(err as Error).message}` };
      }
    }

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/health`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return {
        status: res.ok ? "ready" : "degraded",
        detail: `windmill:http:${res.status}`,
      };
    } catch (err) {
      return { status: "degraded", detail: `windmill:http:${(err as Error).message}` };
    }
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
