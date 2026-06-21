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

export class InMemoryBillingProvider implements BillingProviderPort {
  private readonly accounts = new Map<string, BillingAccount>();

  async readiness(): Promise<BillingEngineReadiness> {
    return { status: "ready", detail: "in-memory billing adapter ready" };
  }

  async ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount> {
    const existing = this.accounts.get(input.organisationId);
    if (existing) return existing;
    const account: BillingAccount = {
      externalAccountId: `acct_${input.organisationId}`,
      organisationId: input.organisationId,
      currency: input.currency,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(input.organisationId, account);
    return account;
  }

  async getAccount(organisationId: string): Promise<BillingAccount | null> {
    return this.accounts.get(organisationId) ?? null;
  }

  async validateWebhookSignature(): Promise<boolean> {
    return true;
  }
}

export class InMemoryPaymentProvider implements PaymentProviderPort {
  async charge(input: ChargeInput): Promise<ChargeResult> {
    return {
      chargeId: `ch_${input.idempotencyKey}`,
      outcome: "succeeded",
      failureReason: null,
    };
  }

  async refund(chargeId: string, amount: number): Promise<RefundResult> {
    return {
      refundId: `rf_${chargeId}`,
      amountRefunded: amount,
      succeeded: true,
    };
  }

  async readiness(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    return { status: "ready", detail: "in-memory payment adapter ready" };
  }
}
