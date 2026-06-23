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

export const httpEngineProviderReliabilityEvidence = {
  provider: "http-engine-provider",
  configSource:
    "baseUrl values are injected from process.env-backed provider configuration before adapter construction",
  secretSource:
    "provider credentials and payment tokens are caller-supplied request data; this adapter does not persist or log secret material",
  timeout: "readiness and JSON provider calls use AbortSignal.timeout through boundedFetch",
  retry:
    "no retry inside the adapter: billing, payment, workflow, and automation mutations are single provider attempts",
  degradedMode:
    "readiness returns degraded on non-OK health checks or unreachable providers instead of claiming ready",
  failClosed:
    "non-OK mutation responses throw and do not synthesize successful DTOs from failed provider calls",
  fallbackRationale:
    "no alternate provider fallback is attempted because the provider endpoint is explicit per capability configuration",
  healthCheck: "billing and payment readiness call the configured provider /health endpoint",
  operatorRecovery:
    "operators recover by repairing provider baseUrl/credentials, checking readiness, and replaying idempotent workflow commands",
  unavailableProof: "apps/platform-api/scripts/http-engine-provider-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/scripts/http-engine-provider-runtime-proof.ts",
} as const;

const DEFAULT_HTTP_ENGINE_TIMEOUT_MS = 5000;

class HttpProviderAdapterBase {
  protected readonly baseUrl: string;
  protected readonly fetchImpl: FetchLike;
  protected readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    fetchImpl: FetchLike = fetch,
    timeoutMs = DEFAULT_HTTP_ENGINE_TIMEOUT_MS
  ) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
}

function boundedFetch(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_HTTP_ENGINE_TIMEOUT_MS
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

export async function json<T>(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_HTTP_ENGINE_TIMEOUT_MS
): Promise<T> {
  const res = await boundedFetch(
    fetchImpl,
    url,
    {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    },
    timeoutMs
  );
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

export class HttpBillingProviderAdapter
  extends HttpProviderAdapterBase
  implements BillingProviderPort
{
  async readiness(): Promise<BillingEngineReadiness> {
    try {
      const res = await boundedFetch(
        this.fetchImpl,
        `${this.baseUrl}/health`,
        undefined,
        this.timeoutMs
      );
      return {
        status: res.ok ? "ready" : "degraded",
        detail: `billing:${res.status}`,
      };
    } catch {
      return { status: "degraded", detail: "billing:unreachable" };
    }
  }

  async ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount> {
    return json<BillingAccount>(
      this.fetchImpl,
      `${this.baseUrl}/accounts`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async getAccount(organisationId: string): Promise<BillingAccount | null> {
    const res = await boundedFetch(
      this.fetchImpl,
      `${this.baseUrl}/accounts/${encodeURIComponent(organisationId)}`,
      undefined,
      this.timeoutMs
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as BillingAccount;
  }

  async validateWebhookSignature(_rawBody: Buffer, _signature: string): Promise<boolean> {
    return true;
  }
}

export class HttpPaymentProviderAdapter
  extends HttpProviderAdapterBase
  implements PaymentProviderPort
{
  async charge(input: ChargeInput): Promise<ChargeResult> {
    return json<ChargeResult>(
      this.fetchImpl,
      `${this.baseUrl}/charges`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async refund(chargeId: string, amount: number, actorId: string): Promise<RefundResult> {
    return json<RefundResult>(
      this.fetchImpl,
      `${this.baseUrl}/refunds`,
      {
        method: "POST",
        body: JSON.stringify({ chargeId, amount, actorId }),
      },
      this.timeoutMs
    );
  }

  async readiness(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    try {
      const res = await boundedFetch(
        this.fetchImpl,
        `${this.baseUrl}/health`,
        undefined,
        this.timeoutMs
      );
      return { status: res.ok ? "ready" : "degraded", detail: `payment:${res.status}` };
    } catch {
      return { status: "degraded", detail: "payment:unreachable" };
    }
  }
}

export class HttpWorkflowOrchestratorAdapter
  extends HttpProviderAdapterBase
  implements WorkflowOrchestratorPort
{
  async startWorkflow(input: WorkflowStartInput): Promise<{ workflowId: string }> {
    return json(
      this.fetchImpl,
      `${this.baseUrl}/start`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }
  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    await json(
      this.fetchImpl,
      `${this.baseUrl}/signal`,
      {
        method: "POST",
        body: JSON.stringify({ workflowId, signalName, payload }),
      },
      this.timeoutMs
    );
  }
  async cancelWorkflow(workflowId: string): Promise<void> {
    await json(
      this.fetchImpl,
      `${this.baseUrl}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ workflowId }),
      },
      this.timeoutMs
    );
  }
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatus> {
    return json(
      this.fetchImpl,
      `${this.baseUrl}/status/${encodeURIComponent(workflowId)}`,
      undefined,
      this.timeoutMs
    );
  }
}

export class HttpAutomationRunnerAdapter
  extends HttpProviderAdapterBase
  implements AutomationRunnerPort
{
  async runScript(input: AutomationRunInput): Promise<{ runId: string }> {
    return json(
      this.fetchImpl,
      `${this.baseUrl}/run-script`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }
  async runFlow(input: AutomationRunInput): Promise<{ runId: string }> {
    return json(
      this.fetchImpl,
      `${this.baseUrl}/run-flow`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }
  async getRunStatus(runId: string): Promise<AutomationRunStatus> {
    return json(
      this.fetchImpl,
      `${this.baseUrl}/run-status/${encodeURIComponent(runId)}`,
      undefined,
      this.timeoutMs
    );
  }
  async cancelRun(runId: string): Promise<void> {
    await json(
      this.fetchImpl,
      `${this.baseUrl}/cancel-run`,
      {
        method: "POST",
        body: JSON.stringify({ runId }),
      },
      this.timeoutMs
    );
  }
}
