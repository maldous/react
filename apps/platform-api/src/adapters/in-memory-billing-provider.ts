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

export type InMemoryBillingProviderConfig = {
  readonly enabled: boolean;
  readonly operationTimeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBackoffMs: number;
  readonly webhookSecret: string | null;
  readonly configSource: string;
  readonly secretSource: string;
  readonly fallbackRationale: string;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadInMemoryBillingProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): InMemoryBillingProviderConfig {
  return {
    enabled: env["IN_MEMORY_BILLING_PROVIDER_DISABLED"] !== "1",
    operationTimeoutMs: parsePositiveInteger(env["IN_MEMORY_BILLING_PROVIDER_TIMEOUT_MS"], 1000),
    retryAttempts: parsePositiveInteger(env["IN_MEMORY_BILLING_PROVIDER_RETRY_ATTEMPTS"], 1),
    retryBackoffMs: parsePositiveInteger(env["IN_MEMORY_BILLING_PROVIDER_RETRY_BACKOFF_MS"], 10),
    webhookSecret: env["IN_MEMORY_BILLING_WEBHOOK_SECRET"] ?? null,
    configSource:
      "process.env IN_MEMORY_BILLING_PROVIDER_DISABLED|IN_MEMORY_BILLING_PROVIDER_TIMEOUT_MS|IN_MEMORY_BILLING_PROVIDER_RETRY_ATTEMPTS|IN_MEMORY_BILLING_PROVIDER_RETRY_BACKOFF_MS|IN_MEMORY_BILLING_WEBHOOK_SECRET",
    secretSource:
      "process.env IN_MEMORY_BILLING_WEBHOOK_SECRET optional local webhook secret; no payment credential, token, or apiKey is used",
    fallbackRationale:
      "no fallback billing or payment provider is used; unavailable or misconfigured billing fails closed",
  };
}

function assertBillingAvailable(config: InMemoryBillingProviderConfig): void {
  if (!config.enabled) {
    throw new Error("in-memory-billing-provider unavailable: disabled; fail closed");
  }
}

async function withBillingReliability<T>(
  operation: () => T | Promise<T>,
  config: InMemoryBillingProviderConfig
): Promise<T> {
  assertBillingAvailable(config);
  const attempts = Math.max(1, config.retryAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const value = await operation();
      if (Date.now() - startedAt > config.operationTimeoutMs) {
        throw new Error(
          `in-memory-billing-provider timeout after ${config.operationTimeoutMs}ms; fail closed`
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
    `in-memory-billing-provider unavailable after retry attempts; fail closed: ${lastError}`
  );
}

export class InMemoryBillingProvider implements BillingProviderPort {
  private readonly accounts = new Map<string, BillingAccount>();
  private readonly config: InMemoryBillingProviderConfig;

  constructor(config: InMemoryBillingProviderConfig = loadInMemoryBillingProviderConfig()) {
    this.config = config;
  }

  async readiness(): Promise<BillingEngineReadiness> {
    if (!this.config.enabled) {
      return {
        status: "unavailable",
        detail: "in-memory billing adapter disabled; fail closed",
      };
    }
    return withBillingReliability(
      () => ({ status: "ready", detail: "in-memory billing adapter ready" }),
      this.config
    );
  }

  async ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount> {
    return withBillingReliability(() => {
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
    }, this.config);
  }

  async getAccount(organisationId: string): Promise<BillingAccount | null> {
    return withBillingReliability(() => this.accounts.get(organisationId) ?? null, this.config);
  }

  async validateWebhookSignature(rawBody: Buffer, signature: string): Promise<boolean> {
    return withBillingReliability(() => {
      if (!this.config.webhookSecret) {
        return signature === "local-proof-signature" && rawBody.length > 0;
      }
      return signature === `local:${this.config.webhookSecret}:${rawBody.length}`;
    }, this.config);
  }

  async healthCheck(): Promise<{ ok: true; accountCount: number } | { ok: false; reason: string }> {
    try {
      return await withBillingReliability(
        () => ({ ok: true as const, accountCount: this.accounts.size }),
        this.config
      );
    } catch (err) {
      return { ok: false, reason: `in-memory-billing-provider unavailable: ${String(err)}` };
    }
  }

  recoveryAction(): string {
    return [
      "operator recovery: unset IN_MEMORY_BILLING_PROVIDER_DISABLED or set it to 0",
      "verify IN_MEMORY_BILLING_PROVIDER_TIMEOUT_MS, IN_MEMORY_BILLING_PROVIDER_RETRY_ATTEMPTS, and IN_MEMORY_BILLING_PROVIDER_RETRY_BACKOFF_MS are positive integers",
      "set IN_MEMORY_BILLING_WEBHOOK_SECRET for signed local webhook verification when required",
      "repair billing provider configuration or switch to Lago, then retry the billing provider proof",
    ].join("; ");
  }
}

export class InMemoryPaymentProvider implements PaymentProviderPort {
  private readonly config: InMemoryBillingProviderConfig;

  constructor(config: InMemoryBillingProviderConfig = loadInMemoryBillingProviderConfig()) {
    this.config = config;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    return withBillingReliability(() => {
      if (input.amount <= 0) {
        return {
          chargeId: `ch_${input.idempotencyKey}`,
          outcome: "failed",
          failureReason: "invalid_amount",
        };
      }
      return {
        chargeId: `ch_${input.idempotencyKey}`,
        outcome: "succeeded",
        failureReason: null,
      };
    }, this.config);
  }

  async refund(chargeId: string, amount: number): Promise<RefundResult> {
    return withBillingReliability(() => {
      if (amount <= 0) {
        throw new Error("invalid_refund_amount; fail closed");
      }
      return {
        refundId: `rf_${chargeId}`,
        amountRefunded: amount,
        succeeded: true,
      };
    }, this.config);
  }

  async readiness(): Promise<{ status: "ready" | "degraded"; detail: string }> {
    if (!this.config.enabled) {
      return { status: "degraded", detail: "in-memory payment adapter disabled; fail closed" };
    }
    return withBillingReliability(
      () => ({ status: "ready", detail: "in-memory payment adapter ready" }),
      this.config
    );
  }
}
