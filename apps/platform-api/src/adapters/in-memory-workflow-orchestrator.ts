import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";

interface WorkflowRecord {
  tenantId: string;
  status: WorkflowStatus["status"];
  detail: string;
  payload: Record<string, unknown>;
}

export type InMemoryWorkflowOrchestratorConfig = {
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

export function loadInMemoryWorkflowOrchestratorConfig(
  env: NodeJS.ProcessEnv = process.env
): InMemoryWorkflowOrchestratorConfig {
  return {
    enabled: env["IN_MEMORY_WORKFLOW_ORCHESTRATOR_DISABLED"] !== "1",
    operationTimeoutMs: parsePositiveInteger(
      env["IN_MEMORY_WORKFLOW_ORCHESTRATOR_TIMEOUT_MS"],
      1000
    ),
    retryAttempts: parsePositiveInteger(env["IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_ATTEMPTS"], 1),
    retryBackoffMs: parsePositiveInteger(
      env["IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_BACKOFF_MS"],
      10
    ),
    configSource:
      "process.env IN_MEMORY_WORKFLOW_ORCHESTRATOR_DISABLED|IN_MEMORY_WORKFLOW_ORCHESTRATOR_TIMEOUT_MS|IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_ATTEMPTS|IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_BACKOFF_MS",
    secretSource: "no secret, credential, token, or apiKey is used by the in-memory orchestrator",
    fallbackRationale:
      "no fallback provider is used; unavailable or misconfigured workflow orchestration fails closed",
  };
}

function assertWorkflowOrchestratorAvailable(config: InMemoryWorkflowOrchestratorConfig): void {
  if (!config.enabled) {
    throw new Error("in-memory-workflow-orchestrator unavailable: disabled; fail closed");
  }
}

async function withWorkflowReliability<T>(
  operation: () => T | Promise<T>,
  config: InMemoryWorkflowOrchestratorConfig
): Promise<T> {
  assertWorkflowOrchestratorAvailable(config);
  const attempts = Math.max(1, config.retryAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const value = await operation();
      if (Date.now() - startedAt > config.operationTimeoutMs) {
        throw new Error(
          `in-memory-workflow-orchestrator timeout after ${config.operationTimeoutMs}ms; fail closed`
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
    `in-memory-workflow-orchestrator unavailable after retry attempts; fail closed: ${lastError}`
  );
}

export class InMemoryWorkflowOrchestrator implements WorkflowOrchestratorPort {
  private readonly workflows = new Map<string, WorkflowRecord>();
  private readonly config: InMemoryWorkflowOrchestratorConfig;

  constructor(
    config: InMemoryWorkflowOrchestratorConfig = loadInMemoryWorkflowOrchestratorConfig()
  ) {
    this.config = config;
  }

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return withWorkflowReliability(() => {
      this.workflows.set(input.workflowId, {
        tenantId: input.tenantId,
        status: "running",
        detail: `started:${input.workflowKey}`,
        payload: { ...input.payload, workflowKey: input.workflowKey },
      });
      return { workflowId: input.workflowId };
    }, this.config);
  }

  async healthCheck(): Promise<
    { ok: true; workflowCount: number } | { ok: false; reason: string }
  > {
    try {
      return await withWorkflowReliability(
        () => ({ ok: true as const, workflowCount: this.workflows.size }),
        this.config
      );
    } catch (err) {
      return { ok: false, reason: `in-memory-workflow-orchestrator unavailable: ${String(err)}` };
    }
  }

  recoveryAction(): string {
    return [
      "operator recovery: unset IN_MEMORY_WORKFLOW_ORCHESTRATOR_DISABLED or set it to 0",
      "verify IN_MEMORY_WORKFLOW_ORCHESTRATOR_TIMEOUT_MS, IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_ATTEMPTS, and IN_MEMORY_WORKFLOW_ORCHESTRATOR_RETRY_BACKOFF_MS are positive integers",
      "repair workflow provider configuration or switch to Temporal, then retry the workflow proof",
    ].join("; ");
  }

  async startWorkflowUnsafe(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return this.startWorkflow(input);
  }

  async unavailableProof(): Promise<void> {
    await withWorkflowReliability(() => undefined, {
      ...this.config,
      enabled: false,
    });
  }

  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    return withWorkflowReliability(() => {
      const record = this.workflows.get(workflowId);
      if (!record) throw new Error("workflow_not_found");
      if (signalName === "approval.requested") {
        record.status = "waiting";
        record.detail = payload["requestedBy"]
          ? `approval_requested:${String(payload["requestedBy"])}`
          : "approval_requested";
        record.payload = { ...record.payload, approvalRequested: payload };
        return;
      }
      if (signalName === "approval.granted") {
        record.status = "completed";
        record.detail = payload["approvedBy"]
          ? `approved:${String(payload["approvedBy"])}`
          : "approved";
        record.payload = { ...record.payload, approvalGranted: payload };
        return;
      }
      if (signalName === "approval.denied") {
        record.status = "failed";
        record.detail = payload["deniedBy"] ? `denied:${String(payload["deniedBy"])}` : "denied";
        record.payload = { ...record.payload, approvalDenied: payload };
        return;
      }
      throw new Error(`unsupported_workflow_signal:${signalName}`);
    }, this.config);
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    return withWorkflowReliability(() => {
      const record = this.workflows.get(workflowId);
      if (!record) throw new Error("workflow_not_found");
      record.status = "cancelled";
      record.detail = "cancelled";
    }, this.config);
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    return withWorkflowReliability(() => {
      const record = this.workflows.get(workflowId);
      if (!record) throw new Error("workflow_not_found");
      return { workflowId, status: record.status, detail: record.detail };
    }, this.config);
  }

  canAccess(workflowId: string, tenantId: string): boolean {
    assertWorkflowOrchestratorAvailable(this.config);
    return this.workflows.get(workflowId)?.tenantId === tenantId;
  }
}
