import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createBillingCatalogPlan,
  createBillingCatalogPrice,
  createBillingCatalogProduct,
  listBillingCatalogPlans,
  listBillingCatalogPrices,
  listBillingCatalogProducts,
} from "../../src/usecases/billing-catalog.ts";

describe("billing catalog usecase", () => {
  it("creates and lists products, plans, and prices", async () => {
    const products = [
      {
        productId: "prod-1",
        name: "Core",
        description: null,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const plans = [
      {
        planId: "plan-1",
        productId: "prod-1",
        name: "Starter",
        currency: "USD",
        billingPeriod: "monthly",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const prices = [
      {
        priceId: "price-1",
        planId: "plan-1",
        version: 1,
        priceType: "flat",
        unitAmount: 1000,
        currency: "USD",
        billingPeriod: "monthly",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const deps = {
      catalog: {
        listProducts: async () => products,
        listPlans: async () => plans,
        listPrices: async () => prices,
        createProduct: async (input: { name: string }) => ({ ...products[0], name: input.name }),
        createPlan: async (input: { name: string }) => ({ ...plans[0], name: input.name }),
        createPrice: async (_input: { planId: string }) => prices[0],
      },
    };
    const product = await createBillingCatalogProduct({ name: "Core", actorId: "user-1" }, deps);
    const plan = await createBillingCatalogPlan(
      {
        productId: "prod-1",
        name: "Starter",
        currency: "USD",
        billingPeriod: "monthly",
        actorId: "user-1",
      },
      deps
    );
    const price = await createBillingCatalogPrice(
      {
        planId: "plan-1",
        priceType: "flat",
        unitAmount: 1000,
        currency: "USD",
        billingPeriod: "monthly",
        actorId: "user-1",
      },
      deps
    );
    assert.equal(product.name, "Core");
    assert.equal(plan.currency, "USD");
    assert.equal(price.unitAmount, 1000);
    assert.equal((await listBillingCatalogProducts(deps)).length, 1);
    assert.equal((await listBillingCatalogPlans(deps)).length, 1);
    assert.equal((await listBillingCatalogPrices(deps)).length, 1);
  });
});
