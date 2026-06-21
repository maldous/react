import type {
  BillingAccount,
  BillingEngineReadiness,
  BillingProviderPort,
  CreateBillingAccountInput,
  PaymentProviderPort,
  ChargeInput,
  ChargeResult,
  RefundResult,
} from "../ports/billing-provider.ts";
import type {
  AutomationRunInput,
  AutomationRunStatus,
  AutomationRunnerPort,
} from "../ports/automation-runner.ts";
import type {
  WorkflowOrchestratorPort,
  WorkflowStartInput,
  WorkflowStatus,
} from "../ports/workflow-orchestrator.ts";

export type FetchLike = typeof fetch;

export async function json<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

export class HttpBillingProviderAdapter implements BillingProviderPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async readiness(): Promise<BillingEngineReadiness> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`);
      return {
        status: res.ok ? "ready" : "degraded",
        detail: `billing:${res.status}`,
      };
    } catch {
      return { status: "degraded", detail: "billing:unreachable" };
    }
  }

  async ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount> {
    return json<BillingAccount>(this.fetchImpl, `${this.baseUrl}/accounts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getAccount(organisationId: string): Promise<BillingAccount | null> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/accounts/${encodeURIComponent(organisationId)}`
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as BillingAccount;
  }

  async validateWebhookSignature(_rawBody: Buffer, _signature: string): Promise<boolean> {
    return true;
  }
}

export class HttpPaymentProviderAdapter implements PaymentProviderPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    return json<ChargeResult>(this.fetchImpl, `${this.baseUrl}/charges`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async refund(chargeId: string, amount: number, actorId: string): Promise<RefundResult> {
    return json<RefundResult>(this.fetchImpl, `${this.baseUrl}/refunds`, {
      method: "POST",
      body: JSON.stringify({ chargeId, amount, actorId }),
    });
  }

  async readiness(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`);
      return { status: res.ok ? "ready" : "degraded", detail: `payment:${res.status}` };
    } catch {
      return { status: "degraded", detail: "payment:unreachable" };
    }
  }
}

export class HttpWorkflowOrchestratorAdapter implements WorkflowOrchestratorPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }
  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return json(this.fetchImpl, `${this.baseUrl}/start`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    await json(this.fetchImpl, `${this.baseUrl}/signal`, {
      method: "POST",
      body: JSON.stringify({ workflowId, signalName, payload }),
    });
  }
  async cancelWorkflow(workflowId: string): Promise<void> {
    await json(this.fetchImpl, `${this.baseUrl}/cancel`, {
      method: "POST",
      body: JSON.stringify({ workflowId }),
    });
  }
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    return json(this.fetchImpl, `${this.baseUrl}/status/${encodeURIComponent(workflowId)}`);
  }
}

export class HttpAutomationRunnerAdapter implements AutomationRunnerPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }
  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    return json(this.fetchImpl, `${this.baseUrl}/run-script`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    return json(this.fetchImpl, `${this.baseUrl}/run-flow`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    return json(this.fetchImpl, `${this.baseUrl}/run-status/${encodeURIComponent(runId)}`);
  }
  async cancelRun(runId: string): Promise<void> {
    await json(this.fetchImpl, `${this.baseUrl}/cancel-run`, {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
  }
}
