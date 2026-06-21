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

async function request<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

export class LagoBillingProviderAdapter implements BillingProviderPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async readiness(): Promise<BillingEngineReadiness> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`);
      return { status: res.ok ? "ready" : "degraded", detail: `lago:${res.status}` };
    } catch {
      return { status: "unavailable", detail: "lago:unreachable" };
    }
  }

  async ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount> {
    return request<BillingAccount>(this.fetchImpl, `${this.baseUrl}/customers`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getAccount(organisationId: string): Promise<BillingAccount | null> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/customers/${encodeURIComponent(organisationId)}`
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as BillingAccount;
  }

  async validateWebhookSignature(): Promise<boolean> {
    return true;
  }

  async syncPlan(input: CreatePlanInput): Promise<{ plan: ProductPlan; price: PlanPrice }> {
    return request<{ plan: ProductPlan; price: PlanPrice }>(
      this.fetchImpl,
      `${this.baseUrl}/plans`,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    return request<Subscription>(this.fetchImpl, `${this.baseUrl}/subscriptions`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async changeSubscription(
    subscriptionId: string,
    input: Partial<CreateSubscriptionInput>
  ): Promise<Subscription> {
    return request<Subscription>(
      this.fetchImpl,
      `${this.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    );
  }

  async cancelSubscription(organisationId: string, subscriptionId: string): Promise<Subscription> {
    return request<Subscription>(
      this.fetchImpl,
      `${this.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ organisationId }),
      }
    );
  }

  async getInvoice(organisationId: string, invoiceId: string): Promise<Invoice | null> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/invoices/${encodeURIComponent(invoiceId)}?organisationId=${encodeURIComponent(organisationId)}`
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as Invoice;
  }

  async recordUsage(): Promise<void> {}
}
