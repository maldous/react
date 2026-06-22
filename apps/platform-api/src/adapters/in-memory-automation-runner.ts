import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

interface RunRecord {
  status: AutomationRunStatus["status"];
  detail: string;
}

interface AutomationAuditRecord {
  runId: string;
  action: string;
  from: AutomationRunStatus["status"] | "none";
  to: AutomationRunStatus["status"];
  at: string;
}

const log = createLogger({
  name: "in-memory-automation-runner",
  service: "platform-api",
  boundedContext: "workflow",
});
const tracer = createTracer("in-memory-automation-runner");
const automationMetrics = new Map<string, number>();

export const inMemoryAutomationStateMachine = {
  states: ["queued", "running", "succeeded", "failed", "cancelled"] as const,
  allowedTransitions: {
    none: ["running"],
    queued: ["running", "cancelled"],
    running: ["succeeded", "failed", "cancelled"],
    succeeded: ["cancelled"],
    failed: [],
    cancelled: [],
  },
  forbiddenTransitions:
    "failed and cancelled are terminal; unknown run ids reject instead of creating implicit runs",
  idempotency:
    "runScript and runFlow are idempotent by runId: duplicate calls return the existing run id without resetting status",
  retry: "withAutomationReliability retries failed operations with configured retry/backoff",
  timeout: "withAutomationReliability enforces operationTimeoutMs and fails closed on timeout",
  compensation: "cancelRun is the compensation/cancel path for operator automation",
  failureHoldingState: "failed is the holding state for failed automation execution",
  operatorRecovery:
    "operator recovery: repair runner configuration or switch to Windmill, then retry/redrive the workflow adapter proof",
};

function recordMetric(operation: string, outcome: "success" | "error"): void {
  const key = `${operation}:${outcome}`;
  automationMetrics.set(key, (automationMetrics.get(key) ?? 0) + 1);
}

export function getInMemoryAutomationMetric(
  operation: string,
  outcome: "success" | "error"
): number {
  return automationMetrics.get(`${operation}:${outcome}`) ?? 0;
}

function transitionRunStatus(
  current: AutomationRunStatus["status"] | "none",
  next: AutomationRunStatus["status"]
): AutomationRunStatus["status"] {
  const allowed = inMemoryAutomationStateMachine.allowedTransitions[current] as readonly string[];
  if (!allowed.includes(next)) {
    throw new Error(`invalid automation transition: ${current}->${next}`);
  }
  return next;
}

export type InMemoryAutomationRunnerConfig = {
  readonly enabled: boolean;
  readonly operationTimeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBackoffMs: number;
  readonly configSource: string;
  readonly secretSource: string;
  readonly fallbackRationale: string;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadInMemoryAutomationRunnerConfig(
  env: NodeJS.ProcessEnv = process.env
): InMemoryAutomationRunnerConfig {
  return {
    enabled: env["IN_MEMORY_AUTOMATION_RUNNER_DISABLED"] !== "1",
    operationTimeoutMs: parsePositiveInteger(env["IN_MEMORY_AUTOMATION_RUNNER_TIMEOUT_MS"], 1000),
    retryAttempts: parsePositiveInteger(env["IN_MEMORY_AUTOMATION_RUNNER_RETRY_ATTEMPTS"], 1),
    retryBackoffMs: parsePositiveInteger(env["IN_MEMORY_AUTOMATION_RUNNER_RETRY_BACKOFF_MS"], 10),
    configSource:
      "process.env IN_MEMORY_AUTOMATION_RUNNER_DISABLED|IN_MEMORY_AUTOMATION_RUNNER_TIMEOUT_MS|IN_MEMORY_AUTOMATION_RUNNER_RETRY_ATTEMPTS|IN_MEMORY_AUTOMATION_RUNNER_RETRY_BACKOFF_MS",
    secretSource: "no secret, credential, token, or apiKey is used by the in-memory runner",
    fallbackRationale:
      "no fallback automation provider is used; unavailable or misconfigured automation fails closed",
  };
}

function assertAutomationRunnerAvailable(config: InMemoryAutomationRunnerConfig): void {
  if (!config.enabled) {
    throw new Error("in-memory-automation-runner unavailable: disabled; fail closed");
  }
}

async function withAutomationReliability<T>(
  operation: () => T | Promise<T>,
  config: InMemoryAutomationRunnerConfig
): Promise<T> {
  assertAutomationRunnerAvailable(config);
  const attempts = Math.max(1, config.retryAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const value = await operation();
      if (Date.now() - startedAt > config.operationTimeoutMs) {
        throw new Error(
          `in-memory-automation-runner timeout after ${config.operationTimeoutMs}ms; fail closed`
        );
      }
      return value;
    } catch (err) {
      lastError = err;
      if (attempt < attempts && config.retryBackoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.retryBackoffMs));
      }
    }
  }
  throw new Error(
    `in-memory-automation-runner unavailable after retry attempts; fail closed: ${lastError}`
  );
}

export class InMemoryAutomationRunner implements AutomationRunnerPort {
  private readonly runs = new Map<string, RunRecord>();
  private readonly auditEvents: AutomationAuditRecord[] = [];
  private readonly config: InMemoryAutomationRunnerConfig;

  constructor(config: InMemoryAutomationRunnerConfig = loadInMemoryAutomationRunnerConfig()) {
    this.config = config;
  }

  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    return this.withAutomationOperation("run-script", input.runId, () => {
      if (this.runs.has(input.runId)) return { runId: input.runId };
      const running = transitionRunStatus("none", "running");
      this.runs.set(input.runId, { status: running, detail: `script:${input.scriptKey}` });
      this.recordAudit(input.runId, "automation.script_started", "none", running);
      const succeeded = transitionRunStatus(running, "succeeded");
      this.runs.set(input.runId, { status: succeeded, detail: `script:${input.scriptKey}` });
      this.recordAudit(input.runId, "automation.script_succeeded", running, succeeded);
      return { runId: input.runId };
    });
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    return this.withAutomationOperation("run-flow", input.runId, () => {
      if (this.runs.has(input.runId)) return { runId: input.runId };
      const running = transitionRunStatus("none", "running");
      this.runs.set(input.runId, { status: running, detail: `flow:${input.scriptKey}` });
      this.recordAudit(input.runId, "automation.flow_started", "none", running);
      const succeeded = transitionRunStatus(running, "succeeded");
      this.runs.set(input.runId, { status: succeeded, detail: `flow:${input.scriptKey}` });
      this.recordAudit(input.runId, "automation.flow_succeeded", running, succeeded);
      return { runId: input.runId };
    });
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    return this.withAutomationOperation("status", runId, () => {
      const record = this.runs.get(runId);
      if (!record) throw new Error("run_not_found");
      return { runId, status: record.status, detail: record.detail };
    });
  }

  async cancelRun(runId: string): Promise<void> {
    return this.withAutomationOperation("cancel", runId, () => {
      const record = this.runs.get(runId);
      if (!record) throw new Error("run_not_found");
      const from = record.status;
      record.status = transitionRunStatus(record.status, "cancelled");
      record.detail = "cancelled";
      this.recordAudit(runId, "automation.cancelled", from, record.status);
    });
  }

  async healthCheck(): Promise<{ ok: true; runCount: number } | { ok: false; reason: string }> {
    try {
      return await withAutomationReliability(
        () => ({ ok: true as const, runCount: this.runs.size }),
        this.config
      );
    } catch (err) {
      return { ok: false, reason: `in-memory-automation-runner unavailable: ${String(err)}` };
    }
  }

  recoveryAction(): string {
    return [
      "operator recovery: unset IN_MEMORY_AUTOMATION_RUNNER_DISABLED or set it to 0",
      "verify IN_MEMORY_AUTOMATION_RUNNER_TIMEOUT_MS, IN_MEMORY_AUTOMATION_RUNNER_RETRY_ATTEMPTS, and IN_MEMORY_AUTOMATION_RUNNER_RETRY_BACKOFF_MS are positive integers",
      "repair automation provider configuration or switch to Windmill, then retry the workflow adapter proof",
    ].join("; ");
  }

  getAuditEvents(): AutomationAuditRecord[] {
    return [...this.auditEvents];
  }

  private recordAudit(
    runId: string,
    action: string,
    from: AutomationRunStatus["status"] | "none",
    to: AutomationRunStatus["status"]
  ): void {
    this.auditEvents.push({ runId, action, from, to, at: new Date().toISOString() });
  }

  private async withAutomationOperation<T>(
    operation: string,
    runId: string,
    run: () => T | Promise<T>
  ): Promise<T> {
    return withSpan(
      tracer,
      `in-memory-automation-runner.${operation}`,
      async () =>
        withAutomationReliability(async () => {
          try {
            const result = await run();
            recordMetric(operation, "success");
            log.info({ operation, runId }, "automation.operation.complete");
            return result;
          } catch (err) {
            recordMetric(operation, "error");
            log.error({ err, operation, runId }, "automation.operation.failed");
            throw err;
          }
        }, this.config),
      { "workflow.operation": operation, "automation.run_id": runId }
    );
  }
}
