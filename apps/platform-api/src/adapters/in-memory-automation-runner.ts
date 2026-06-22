import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";

interface RunRecord {
  status: AutomationRunStatus["status"];
  detail: string;
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
  private readonly config: InMemoryAutomationRunnerConfig;

  constructor(config: InMemoryAutomationRunnerConfig = loadInMemoryAutomationRunnerConfig()) {
    this.config = config;
  }

  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    return withAutomationReliability(() => {
      this.runs.set(input.runId, { status: "succeeded", detail: `script:${input.scriptKey}` });
      return { runId: input.runId };
    }, this.config);
  }

  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    return withAutomationReliability(() => {
      this.runs.set(input.runId, { status: "succeeded", detail: `flow:${input.scriptKey}` });
      return { runId: input.runId };
    }, this.config);
  }

  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    return withAutomationReliability(() => {
      const record = this.runs.get(runId);
      if (!record) throw new Error("run_not_found");
      return { runId, status: record.status, detail: record.detail };
    }, this.config);
  }

  async cancelRun(runId: string): Promise<void> {
    return withAutomationReliability(() => {
      const record = this.runs.get(runId);
      if (!record) throw new Error("run_not_found");
      record.status = "cancelled";
      record.detail = "cancelled";
    }, this.config);
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
}
