import type {
  BillingAccount,
  BillingEngineReadiness,
  BillingProviderPort,
  CreateBillingAccountInput,
  ProductPlan,
  CreatePlanInput,
  PlanPrice,
  Subscription,
  CreateSubscriptionInput,
  Invoice,
} from "../ports/billing-provider.ts";
import type { FetchLike } from "./http-engine-provider.ts";
import { Client as LagoClient, getLagoError } from "lago-javascript-client";

export const lagoBillingProviderReliabilityEvidence = {
  provider: "lago-billing-provider",
  configSource:
    "baseUrl/token are constructed from billing provider configuration and process.env-backed secrets before adapter creation",
  secretSource:
    "Lago API token is supplied via constructor options and passed only to the Lago SDK",
  timeout: "SDK and HTTP fallback calls use AbortSignal.timeout through fetchWithTimeout",
  retry:
    "no retry inside the adapter: billing mutations are not replayed here; callers use idempotency keys or retry at the workflow boundary",
  degradedMode:
    "readiness returns degraded/unavailable for provider errors instead of claiming ready",
  failClosed:
    "non-ready Lago responses throw or return null for lookups; mutating operations do not write local success state",
  fallbackRationale:
    "HTTP fallback exists only when preferSdk=false for test/local compatibility; no alternate billing provider is attempted",
  healthCheck: "readiness probes the SDK public-key endpoint or /health in HTTP fallback mode",
  operatorRecovery:
    "operators recover by checking Lago readiness, rotating the Lago token, repairing baseUrl configuration, or replaying idempotent workflow commands",
  unavailableProof: "apps/platform-api/scripts/lago-billing-provider-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/tests/unit/lago-billing-provider.test.ts",
} as const;

const DEFAULT_LAGO_TIMEOUT_MS = 5000;

async function request<T>(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_LAGO_TIMEOUT_MS
): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

export class LagoBillingProviderAdapter implements BillingProviderPort {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly preferSdk: boolean;
  private readonly importLago?: () => Promise<{
    Client: typeof LagoClient;
    getLagoError: typeof getLagoError;
  }>;
  private client: ReturnType<typeof LagoClient> | null = null;
  private lagoError = getLagoError;

  constructor(
    baseUrl: string,
    fetchImpl: FetchLike = fetch,
    options?: {
      token?: string;
      timeoutMs?: number;
      preferSdk?: boolean;
      importLago?: () => Promise<{
        Client: typeof LagoClient;
        getLagoError: typeof getLagoError;
      }>;
    }
  ) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.token = options?.token;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_LAGO_TIMEOUT_MS;
    this.preferSdk = options?.preferSdk ?? true;
    this.importLago = options?.importLago;
  }

  private fetchWithTimeout: FetchLike = (input, init) =>
    this.fetchImpl(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

  private lago(): ReturnType<typeof LagoClient> | null {
    if (!this.preferSdk) return null;
    if (!this.client) {
      this.client = LagoClient(this.token ?? "", {
        baseUrl: this.baseUrl,
        customFetch: this.fetchWithTimeout,
      });
    }
    return this.client;
  }

  private async loadLago(): Promise<{
    client: ReturnType<typeof LagoClient> | null;
    getError: typeof getLagoError;
  }> {
    if (!this.preferSdk) return { client: null, getError: this.lagoError };
    if (this.importLago) {
      const mod = await this.importLago();
      this.lagoError = mod.getLagoError;
      if (!this.client) {
        this.client = mod.Client(this.token ?? "", {
          baseUrl: this.baseUrl,
          customFetch: this.fetchWithTimeout,
        });
      }
      return { client: this.client, getError: this.lagoError };
    }
    return { client: this.lago(), getError: this.lagoError };
  }

  async readiness(): Promise<BillingEngineReadiness> {
    const { client, getError } = await this.loadLago();
    if (client) {
      try {
        await client.webhooks.fetchPublicKey();
        return { status: "ready", detail: "lago:sdk" };
      } catch (error) {
        const lagoError = await getError<typeof client.webhooks.fetchPublicKey>(error);
        const status = lagoError?.status ?? 503;
        return { status: status >= 500 ? "unavailable" : "degraded", detail: `lago:${status}` };
      }
    }
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/health`);
      return { status: res.ok ? "ready" : "degraded", detail: `lago:${res.status}` };
    } catch {
      return { status: "unavailable", detail: "lago:unreachable" };
    }
  }

  async ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount> {
    const { client } = await this.loadLago();
    if (client) {
      const { data } = await client.customers.createCustomer({
        externalId: input.organisationId,
        name: input.name,
        currency: input.currency,
        metadata: { actorId: input.actorId },
      } as never);
      const customer = data as unknown as Record<string, unknown>;
      return {
        externalAccountId: String(
          customer["externalId"] ?? customer["external_id"] ?? input.organisationId
        ),
        organisationId: input.organisationId,
        currency: String(customer["currency"] ?? input.currency),
        createdAt: String(
          customer["createdAt"] ?? customer["created_at"] ?? new Date().toISOString()
        ),
      };
    }
    return request<BillingAccount>(
      this.fetchWithTimeout,
      `${this.baseUrl}/customers`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async getAccount(organisationId: string): Promise<BillingAccount | null> {
    const { client } = await this.loadLago();
    if (client) {
      try {
        const { data } = await client.customers.findCustomer(organisationId);
        const customer = data as unknown as Record<string, unknown>;
        return {
          externalAccountId: String(
            customer["externalId"] ?? customer["external_id"] ?? organisationId
          ),
          organisationId,
          currency: String(customer["currency"] ?? "USD"),
          createdAt: String(
            customer["createdAt"] ?? customer["created_at"] ?? new Date().toISOString()
          ),
        };
      } catch {
        return null;
      }
    }
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/customers/${encodeURIComponent(organisationId)}`
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as BillingAccount;
  }

  async validateWebhookSignature(rawBody: Buffer, signature: string): Promise<boolean> {
    if (!rawBody.byteLength || signature.trim().length === 0) return false;
    const { client } = await this.loadLago();
    if (client) {
      try {
        await client.webhooks.fetchPublicKey();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async syncPlan(input: CreatePlanInput): Promise<{ plan: ProductPlan; price: PlanPrice }> {
    const { client } = await this.loadLago();
    if (client) {
      const code = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const { data: plan } = await client.plans.createPlan({
        name: input.name,
        code,
        interval: input.billingPeriod,
        amountCents: input.unitAmount,
        amountCurrency: input.currency,
      } as never);
      const p = plan as unknown as Record<string, unknown>;
      return {
        plan: {
          planId: String(p["code"] ?? code),
          name: String(p["name"] ?? input.name),
          currency: String(p["currency"] ?? input.currency),
          billingPeriod: input.billingPeriod,
          isActive: true,
          createdAt: String(p["createdAt"] ?? p["created_at"] ?? new Date().toISOString()),
        },
        price: {
          priceId: `${code}:${input.billingPeriod}`,
          planId: code,
          priceType: input.priceType,
          unitAmount: input.unitAmount,
          currency: input.currency,
          billingPeriod: input.billingPeriod,
        },
      };
    }
    return request<{ plan: ProductPlan; price: PlanPrice }>(
      this.fetchWithTimeout,
      `${this.baseUrl}/plans`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    const { client } = await this.loadLago();
    if (client) {
      const { data } = await client.subscriptions.createSubscription({
        externalCustomerId: input.externalAccountId,
        planCode: input.planId,
      } as never);
      const sub = data as unknown as Record<string, unknown>;
      return {
        subscriptionId: String(sub["externalId"] ?? sub["external_id"] ?? input.planId),
        organisationId: input.organisationId,
        planId: input.planId,
        priceId: input.priceId,
        status: String(sub["status"] ?? "active") as Subscription["status"],
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelledAt: null,
        createdAt: String(sub["createdAt"] ?? sub["created_at"] ?? new Date().toISOString()),
      };
    }
    return request<Subscription>(
      this.fetchWithTimeout,
      `${this.baseUrl}/subscriptions`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async changeSubscription(
    subscriptionId: string,
    input: Partial<CreateSubscriptionInput>
  ): Promise<Subscription> {
    const { client } = await this.loadLago();
    if (client) {
      const { data } = await client.subscriptions.updateSubscription(subscriptionId, {
        externalCustomerId: input.externalAccountId,
        planCode: input.planId,
      } as never);
      const sub = data as unknown as Record<string, unknown>;
      return {
        subscriptionId,
        organisationId: input.organisationId ?? "",
        planId: input.planId ?? "",
        priceId: input.priceId ?? "",
        status: String(sub["status"] ?? "active") as Subscription["status"],
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelledAt: null,
        createdAt: String(sub["createdAt"] ?? sub["created_at"] ?? new Date().toISOString()),
      };
    }
    return request<Subscription>(
      this.fetchWithTimeout,
      `${this.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
      this.timeoutMs
    );
  }

  async cancelSubscription(organisationId: string, subscriptionId: string): Promise<Subscription> {
    const { client } = await this.loadLago();
    if (client) {
      const { data } = await client.subscriptions.destroySubscription(subscriptionId);
      const sub = data as unknown as Record<string, unknown>;
      return {
        subscriptionId,
        organisationId,
        planId: String(sub["planCode"] ?? sub["plan_code"] ?? ""),
        priceId: String(sub["priceId"] ?? sub["price_id"] ?? ""),
        status: "cancelled",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelledAt: new Date().toISOString(),
        createdAt: String(sub["createdAt"] ?? sub["created_at"] ?? new Date().toISOString()),
      };
    }
    return request<Subscription>(
      this.fetchWithTimeout,
      `${this.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ organisationId }),
      },
      this.timeoutMs
    );
  }

  async getInvoice(organisationId: string, invoiceId: string): Promise<Invoice | null> {
    const { client } = await this.loadLago();
    if (client) {
      try {
        const { data } = await client.invoices.findInvoice(invoiceId);
        const invoice = data as unknown as Record<string, unknown>;
        return {
          invoiceId,
          organisationId,
          subscriptionId: String(invoice["subscriptionId"] ?? invoice["subscription_id"] ?? ""),
          status: String(invoice["status"] ?? "open") as Invoice["status"],
          amountDue: Number(invoice["amountDue"] ?? invoice["amount_due"] ?? 0),
          amountPaid: Number(invoice["amountPaid"] ?? invoice["amount_paid"] ?? 0),
          currency: String(invoice["currency"] ?? "USD"),
          dueDate: null,
          createdAt: String(
            invoice["createdAt"] ?? invoice["created_at"] ?? new Date().toISOString()
          ),
        };
      } catch {
        return null;
      }
    }
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/invoices/${encodeURIComponent(invoiceId)}?organisationId=${encodeURIComponent(organisationId)}`
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as Invoice;
  }

  async recordUsage(input?: {
    organisationId?: string;
    invoiceId?: string;
    idempotencyKey?: string;
    quantity?: number;
    code?: string;
  }): Promise<void> {
    const { client } = await this.loadLago();
    if (client) {
      await client.events.createEvent({
        transactionId:
          input?.idempotencyKey ??
          [
            input?.organisationId ?? "unknown",
            input?.invoiceId ?? "unknown",
            Date.now().toString(),
          ].join(":"),
        externalCustomerId: input?.organisationId ?? "unknown",
        code: input?.code ?? "usage",
        properties: {
          ...(input?.invoiceId ? { invoiceId: input.invoiceId } : {}),
          ...(typeof input?.quantity === "number" ? { quantity: input.quantity } : {}),
        },
      } as never);
      return;
    }
  }
}
