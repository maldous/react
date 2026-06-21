import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LagoBillingProviderAdapter } from "../../src/adapters/lago-billing-provider.ts";

describe("LagoBillingProviderAdapter", () => {
  it("uses the injected SDK path for readiness and catalog operations", async () => {
    const calls: string[] = [];
    const sdk = {
      Client: (_token: string, _opts: { baseUrl: string; customFetch: typeof fetch }) => ({
        webhooks: {
          fetchPublicKey: async () => {
            calls.push("webhooks.fetchPublicKey");
            return "public-key";
          },
        },
        customers: {
          createCustomer: async (input: unknown) => {
            calls.push("customers.createCustomer");
            return {
              data: {
                externalId: "cust-1",
                currency: "USD",
                createdAt: "2026-01-01T00:00:00Z",
                input,
              },
            };
          },
          findCustomer: async (organisationId: string) => {
            calls.push(`customers.findCustomer:${organisationId}`);
            return {
              data: {
                externalId: organisationId,
                currency: "USD",
                createdAt: "2026-01-01T00:00:00Z",
              },
            };
          },
        },
        plans: {
          createPlan: async (input: unknown) => {
            calls.push("plans.createPlan");
            return {
              data: {
                code: "starter",
                name: "Starter",
                currency: "USD",
                createdAt: "2026-01-01T00:00:00Z",
                input,
              },
            };
          },
        },
        subscriptions: {
          createSubscription: async (input: unknown) => {
            calls.push("subscriptions.createSubscription");
            return {
              data: {
                externalId: "sub-1",
                status: "active",
                createdAt: "2026-01-01T00:00:00Z",
                input,
              },
            };
          },
          updateSubscription: async (subscriptionId: string, input: unknown) => {
            calls.push(`subscriptions.updateSubscription:${subscriptionId}`);
            return { data: { status: "active", createdAt: "2026-01-01T00:00:00Z", input } };
          },
          destroySubscription: async (subscriptionId: string) => {
            calls.push(`subscriptions.destroySubscription:${subscriptionId}`);
            return {
              data: {
                planCode: "starter",
                priceId: "starter:monthly",
                createdAt: "2026-01-01T00:00:00Z",
              },
            };
          },
        },
        invoices: {
          findInvoice: async (invoiceId: string) => {
            calls.push(`invoices.findInvoice:${invoiceId}`);
            return {
              data: {
                subscriptionId: "sub-1",
                status: "open",
                amountDue: 1000,
                amountPaid: 0,
                currency: "USD",
                createdAt: "2026-01-01T00:00:00Z",
              },
            };
          },
        },
        events: {
          createEvent: async () => {
            calls.push("events.createEvent");
            return { data: {} };
          },
        },
      }),
      getLagoError: async () => ({ status: 200 }),
    };

    const adapter = new LagoBillingProviderAdapter("http://lago.local", fetch, {
      token: "token",
      importLago: async () => sdk as never,
    });

    assert.equal((await adapter.readiness()).status, "ready");
    const account = await adapter.ensureAccount({
      organisationId: "org-1",
      currency: "USD",
      name: "Org 1",
      actorId: "actor-1",
    });
    const plan = await adapter.syncPlan({
      name: "Starter",
      currency: "USD",
      billingPeriod: "monthly",
      unitAmount: 1000,
      priceType: "flat",
      actorId: "actor-1",
    });
    const subscription = await adapter.createSubscription({
      organisationId: "org-1",
      planId: plan.plan.planId,
      priceId: plan.price.priceId,
      externalAccountId: account.externalAccountId,
      actorId: "actor-1",
    });
    const invoice = await adapter.getInvoice("org-1", "inv-1");
    await adapter.recordUsage({
      organisationId: "org-1",
      invoiceId: "inv-1",
      idempotencyKey: "usage-1",
      quantity: 3,
      code: "meter.usage",
    });
    assert.equal(await adapter.validateWebhookSignature(Buffer.from("body"), "sig"), true);

    assert.equal(account.externalAccountId, "cust-1");
    assert.equal(plan.plan.planId, "starter");
    assert.equal(subscription.subscriptionId, "sub-1");
    assert.equal(invoice?.invoiceId, "inv-1");
    assert.deepEqual(calls, [
      "webhooks.fetchPublicKey",
      "customers.createCustomer",
      "plans.createPlan",
      "subscriptions.createSubscription",
      "invoices.findInvoice:inv-1",
      "events.createEvent",
      "webhooks.fetchPublicKey",
    ]);
  });
});
