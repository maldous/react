import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";
import type { FetchLike } from "./http-engine-provider.ts";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

type WindmillClientModule = typeof import("windmill-client");
type AutomationAuditRecord = {
  runId: string;
  action: string;
  transition: string;
  at: string;
};

const log = createLogger({
  name: "windmill-automation-provider",
  service: "platform-api",
  boundedContext: "workflow",
});
const tracer = createTracer("windmill-automation-provider");
const windmillAutomationMetrics = new Map<string, number>();

function metric(operation: string, outcome: "success" | "error"): void {
  const key = `${operation}:${outcome}`;
  windmillAutomationMetrics.set(key, (windmillAutomationMetrics.get(key) ?? 0) + 1);
}

export function getWindmillAutomationProviderMetric(
  operation: string,
  outcome: "success" | "error"
): number {
  return windmillAutomationMetrics.get(`${operation}:${outcome}`) ?? 0;
}

export const windmillAutomationStateMachineEvidence = {
  stateMachineDefinition:
    "Windmill is provider-authoritative; adapter normalizes provider status to queued|running|succeeded|failed|cancelled",
  allowedTransitions:
    "allowed transition operations are runScript/runFlow, getRunStatus, and cancelRun; Windmill rejects invalid provider transitions",
  forbiddenTransitions:
    "forbidden transitions and unknown runs surface as non-OK provider errors instead of fabricated success",
  idempotency:
    "runScript and runFlow pass caller-supplied runId/jobId so Windmill operations are idempotency-keyed by run id",
  audit: "adapter records local audit entries for run start, status observation, and cancellation",
};

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
  private readonly auditEvents: AutomationAuditRecord[] = [];

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
    return this.withAutomationOperation("run-script", input.runId, async () => {
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
        this.recordAudit(id, "automation.script_started", "none->running");
        return { runId: id };
      }

      const { json } = await import("./http-engine-provider.ts");
      const result = await json<{ runId: string }>(
        this.fetchImpl,
        `${this.baseUrl}/api/run-script`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        this.timeoutMs
      );
      this.recordAudit(result.runId, "automation.script_started", "none->running");
      return result;
    });
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    return this.withAutomationOperation("run-flow", input.runId, async () => {
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
        this.recordAudit(id, "automation.flow_started", "none->running");
        return { runId: id };
      }

      const { json } = await import("./http-engine-provider.ts");
      const result = await json<{ runId: string }>(
        this.fetchImpl,
        `${this.baseUrl}/api/run-flow`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        this.timeoutMs
      );
      this.recordAudit(result.runId, "automation.flow_started", "none->running");
      return result;
    });
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    return this.withAutomationOperation("status", runId, async () => {
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
        const normalized = this.normalizeStatus(status);
        this.recordAudit(runId, "automation.status_observed", `provider->${normalized}`);
        return { runId, status: normalized, detail: status };
      }

      const { json } = await import("./http-engine-provider.ts");
      const status = await json<AutomationRunStatus>(
        this.fetchImpl,
        `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}`,
        undefined,
        this.timeoutMs
      );
      this.recordAudit(runId, "automation.status_observed", `provider->${status.status}`);
      return status;
    });
  }

  async cancelRun(runId: string): Promise<void> {
    return this.withAutomationOperation("cancel", runId, async () => {
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
        this.recordAudit(runId, "automation.cancelled", "provider-state->cancelled");
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
      this.recordAudit(runId, "automation.cancelled", "provider-state->cancelled");
    });
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

  getAuditEvents(): AutomationAuditRecord[] {
    return [...this.auditEvents];
  }

  private recordAudit(runId: string, action: string, transition: string): void {
    this.auditEvents.push({ runId, action, transition, at: new Date().toISOString() });
  }

  private async withAutomationOperation<T>(
    operation: string,
    runId: string,
    run: () => Promise<T>
  ): Promise<T> {
    return withSpan(
      tracer,
      `windmill-automation-provider.${operation}`,
      async () => {
        try {
          const result = await run();
          metric(operation, "success");
          log.info({ operation, runId }, "windmill_automation.operation.complete");
          return result;
        } catch (err) {
          metric(operation, "error");
          log.error({ err, operation, runId }, "windmill_automation.operation.failed");
          throw err;
        }
      },
      { "workflow.operation": operation, "automation.run_id": runId }
    );
  }
}
