import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryBillingProvider,
  InMemoryPaymentProvider,
  loadInMemoryBillingProviderConfig,
} from "../../src/adapters/in-memory-billing-provider.ts";

describe("InMemoryBillingProvider provider reliability", () => {
  it("loads provider config and secret source from explicit environment sources", () => {
    const config = loadInMemoryBillingProviderConfig({
      IN_MEMORY_BILLING_PROVIDER_TIMEOUT_MS: "150",
      IN_MEMORY_BILLING_PROVIDER_RETRY_ATTEMPTS: "2",
      IN_MEMORY_BILLING_PROVIDER_RETRY_BACKOFF_MS: "5",
      IN_MEMORY_BILLING_WEBHOOK_SECRET: "local-secret",
    });

    assert.equal(config.enabled, true);
    assert.equal(config.operationTimeoutMs, 150);
    assert.equal(config.retryAttempts, 2);
    assert.equal(config.retryBackoffMs, 5);
    assert.equal(config.webhookSecret, "local-secret");
    assert.match(config.configSource, /process\.env/);
    assert.match(config.secretSource, /secret|token|apiKey/i);
    assert.match(config.fallbackRationale, /no fallback|fail closed/i);
  });

  it("ensures accounts idempotently and verifies local webhook signatures", async () => {
    const config = loadInMemoryBillingProviderConfig({
      IN_MEMORY_BILLING_WEBHOOK_SECRET: "local-secret",
    });
    const billing = new InMemoryBillingProvider(config);

    assert.equal((await billing.readiness()).status, "ready");
    const first = await billing.ensureAccount({
      organisationId: "org-1",
      currency: "USD",
      name: "Org 1",
      actorId: "actor-1",
    });
    const second = await billing.ensureAccount({
      organisationId: "org-1",
      currency: "USD",
      name: "Org 1 renamed",
      actorId: "actor-2",
    });

    assert.equal(first.externalAccountId, "acct_org-1");
    assert.deepEqual(second, first);
    assert.deepEqual(await billing.getAccount("org-1"), first);
    assert.equal(
      await billing.validateWebhookSignature(Buffer.from("body"), "local:local-secret:4"),
      true
    );
    assert.equal(await billing.validateWebhookSignature(Buffer.from("body"), "wrong"), false);

    const health = await billing.healthCheck();
    assert.equal(health.ok, true);
    assert.equal(health.ok && health.accountCount, 1);
  });

  it("fails closed when disabled and exposes operator recovery guidance", async () => {
    const disabledConfig = {
      ...loadInMemoryBillingProviderConfig({}),
      enabled: false,
    };
    const billing = new InMemoryBillingProvider(disabledConfig);
    const payment = new InMemoryPaymentProvider(disabledConfig);

    assert.equal((await billing.readiness()).status, "unavailable");
    await assert.rejects(
      () =>
        billing.ensureAccount({
          organisationId: "org-disabled",
          currency: "USD",
          name: "Disabled",
          actorId: "actor-1",
        }),
      /fail closed/i
    );
    assert.equal((await billing.healthCheck()).ok, false);
    assert.match(billing.recoveryAction(), /operator recovery|repair|retry/i);
    assert.equal((await payment.readiness()).status, "degraded");
    await assert.rejects(
      () =>
        payment.charge({
          organisationId: "org-disabled",
          invoiceId: "inv-1",
          amount: 100,
          currency: "USD",
          paymentMethodToken: "pm-1",
          idempotencyKey: "idemp-disabled",
        }),
      /fail closed/i
    );
  });

  it("fails payment operations for invalid amounts", async () => {
    const payment = new InMemoryPaymentProvider();

    assert.deepEqual(
      await payment.charge({
        organisationId: "org-1",
        invoiceId: "inv-1",
        amount: 0,
        currency: "USD",
        paymentMethodToken: "pm-1",
        idempotencyKey: "idemp-invalid",
      }),
      {
        chargeId: "ch_idemp-invalid",
        outcome: "failed",
        failureReason: "invalid_amount",
      }
    );
    await assert.rejects(() => payment.refund("ch_1", 0, "actor-1"), /fail closed/i);
  });
});
