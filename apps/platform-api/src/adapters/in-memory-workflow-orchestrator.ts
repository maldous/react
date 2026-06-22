import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

interface WorkflowRecord {
  tenantId: string;
  status: WorkflowStatus["status"];
  detail: string;
  payload: Record<string, unknown>;
}

interface WorkflowAuditRecord {
  workflowId: string;
  action: string;
  from: WorkflowStatus["status"] | "none";
  to: WorkflowStatus["status"];
  at: string;
}

const log = createLogger({
  name: "in-memory-workflow-orchestrator",
  service: "platform-api",
  boundedContext: "workflow",
});
const tracer = createTracer("in-memory-workflow-orchestrator");
const workflowMetrics = new Map<string, number>();
const terminalWorkflowStates = new Set<WorkflowStatus["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
export const inMemoryWorkflowStateMachine = {
  states: ["running", "waiting", "completed", "failed", "cancelled"] as const,
  allowedTransitions: {
    none: ["running"],
    running: ["waiting", "cancelled"],
    waiting: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  },
  forbiddenTransitions:
    "completed|failed|cancelled are terminal; approval.granted and approval.denied are invalid before approval.requested",
  retry: "withWorkflowReliability retries failed operations with configured retry/backoff",
  timeout: "withWorkflowReliability enforces operationTimeoutMs and fails closed on timeout",
  idempotency:
    "startWorkflow is idempotent by workflowId: duplicate starts return the existing workflow id without resetting state",
  compensation:
    "cancelWorkflow is the compensation/cancel path and is forbidden after terminal completion or failure",
  failureHoldingState: "approval.denied transitions waiting workflow into failed holding state",
  operatorRecovery:
    "operator recovery: repair provider configuration or switch to Temporal, then retry/redrive the workflow proof",
};

function recordMetric(operation: string, outcome: "success" | "error"): void {
  const key = `${operation}:${outcome}`;
  workflowMetrics.set(key, (workflowMetrics.get(key) ?? 0) + 1);
}

export function getInMemoryWorkflowMetric(operation: string, outcome: "success" | "error"): number {
  return workflowMetrics.get(`${operation}:${outcome}`) ?? 0;
}

function transitionWorkflowStatus(
  current: WorkflowStatus["status"] | "none",
  next: WorkflowStatus["status"]
): WorkflowStatus["status"] {
  const allowed = inMemoryWorkflowStateMachine.allowedTransitions[current] as readonly string[];
  if (!allowed.includes(next)) {
    throw new Error(`invalid workflow transition: ${current}->${next}`);
  }
  return next;
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
  private readonly auditEvents: WorkflowAuditRecord[] = [];
  private readonly config: InMemoryWorkflowOrchestratorConfig;

  constructor(
    config: InMemoryWorkflowOrchestratorConfig = loadInMemoryWorkflowOrchestratorConfig()
  ) {
    this.config = config;
  }

  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return this.withWorkflowOperation("start", input.workflowId, () => {
      const existing = this.workflows.get(input.workflowId);
      if (existing) {
        return { workflowId: input.workflowId };
      }
      const status = transitionWorkflowStatus("none", "running");
      this.workflows.set(input.workflowId, {
        tenantId: input.tenantId,
        status,
        detail: `started:${input.workflowKey}`,
        payload: { ...input.payload, workflowKey: input.workflowKey },
      });
      this.recordAudit(input.workflowId, "workflow.started", "none", status);
      return { workflowId: input.workflowId };
    });
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
    return this.withWorkflowOperation("signal", workflowId, () => {
      const record = this.workflows.get(workflowId);
      if (!record) throw new Error("workflow_not_found");
      if (signalName === "approval.requested") {
        const from = record.status;
        record.status = transitionWorkflowStatus(record.status, "waiting");
        record.detail = payload["requestedBy"]
          ? `approval_requested:${String(payload["requestedBy"])}`
          : "approval_requested";
        record.payload = { ...record.payload, approvalRequested: payload };
        this.recordAudit(workflowId, "workflow.approval_requested", from, record.status);
        return;
      }
      if (signalName === "approval.granted") {
        const from = record.status;
        record.status = transitionWorkflowStatus(record.status, "completed");
        record.detail = payload["approvedBy"]
          ? `approved:${String(payload["approvedBy"])}`
          : "approved";
        record.payload = { ...record.payload, approvalGranted: payload };
        this.recordAudit(workflowId, "workflow.approval_granted", from, record.status);
        return;
      }
      if (signalName === "approval.denied") {
        const from = record.status;
        record.status = transitionWorkflowStatus(record.status, "failed");
        record.detail = payload["deniedBy"] ? `denied:${String(payload["deniedBy"])}` : "denied";
        record.payload = { ...record.payload, approvalDenied: payload };
        this.recordAudit(workflowId, "workflow.approval_denied", from, record.status);
        return;
      }
      throw new Error(`unsupported_workflow_signal:${signalName}`);
    });
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    return this.withWorkflowOperation("cancel", workflowId, () => {
      const record = this.workflows.get(workflowId);
      if (!record) throw new Error("workflow_not_found");
      const from = record.status;
      if (terminalWorkflowStates.has(record.status)) {
        throw new Error(`forbidden workflow cancel from terminal state:${record.status}`);
      }
      record.status = transitionWorkflowStatus(record.status, "cancelled");
      record.detail = "cancelled";
      this.recordAudit(workflowId, "workflow.cancelled", from, record.status);
    });
  }

  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    return this.withWorkflowOperation("status", workflowId, () => {
      const record = this.workflows.get(workflowId);
      if (!record) throw new Error("workflow_not_found");
      return { workflowId, status: record.status, detail: record.detail };
    });
  }

  canAccess(workflowId: string, tenantId: string): boolean {
    assertWorkflowOrchestratorAvailable(this.config);
    return this.workflows.get(workflowId)?.tenantId === tenantId;
  }

  getAuditEvents(): WorkflowAuditRecord[] {
    return [...this.auditEvents];
  }

  private recordAudit(
    workflowId: string,
    action: string,
    from: WorkflowStatus["status"] | "none",
    to: WorkflowStatus["status"]
  ): void {
    this.auditEvents.push({ workflowId, action, from, to, at: new Date().toISOString() });
  }

  private async withWorkflowOperation<T>(
    operation: string,
    workflowId: string,
    run: () => T | Promise<T>
  ): Promise<T> {
    return withSpan(
      tracer,
      `in-memory-workflow-orchestrator.${operation}`,
      async () =>
        withWorkflowReliability(async () => {
          try {
            const result = await run();
            recordMetric(operation, "success");
            log.info({ operation, workflowId }, "workflow.operation.complete");
            return result;
          } catch (err) {
            recordMetric(operation, "error");
            log.error({ err, operation, workflowId }, "workflow.operation.failed");
            throw err;
          }
        }, this.config),
      { "workflow.operation": operation, "workflow.id": workflowId }
    );
  }
}
