import http from "node:http";
import { strict as assert } from "node:assert";
import { LagoBillingProviderAdapter } from "../src/adapters/lago-billing-provider.ts";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (body: unknown, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url === "/health") return send({ ok: true });
    if (req.method === "POST" && url === "/customers")
      return send({
        externalAccountId: "cust_1",
        organisationId: "org-1",
        currency: "USD",
        createdAt: new Date().toISOString(),
      });
    if (req.method === "GET" && url.startsWith("/customers/"))
      return send({
        externalAccountId: "cust_1",
        organisationId: "org-1",
        currency: "USD",
        createdAt: null,
      });
    if (req.method === "POST" && url === "/plans")
      return send({
        plan: {
          planId: "plan_1",
          name: "Pro",
          currency: "USD",
          billingPeriod: "monthly",
          isActive: true,
          createdAt: new Date().toISOString(),
        },
        price: {
          priceId: "price_1",
          planId: "plan_1",
          priceType: "flat",
          unitAmount: 1000,
          currency: "USD",
          billingPeriod: "monthly",
        },
      });
    if (req.method === "POST" && url === "/subscriptions")
      return send({
        subscriptionId: "sub_1",
        organisationId: "org-1",
        planId: "plan_1",
        priceId: "price_1",
        status: "active",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelledAt: null,
        createdAt: null,
      });
    if (req.method === "PATCH" && url.startsWith("/subscriptions/"))
      return send({
        subscriptionId: "sub_1",
        organisationId: "org-1",
        planId: "plan_1",
        priceId: "price_1",
        status: "paused",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelledAt: null,
        createdAt: null,
      });
    if (req.method === "POST" && url.endsWith("/cancel"))
      return send({
        subscriptionId: "sub_1",
        organisationId: "org-1",
        planId: "plan_1",
        priceId: "price_1",
        status: "cancelled",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelledAt: new Date().toISOString(),
        createdAt: null,
      });
    if (req.method === "GET" && url.startsWith("/invoices/"))
      return send({
        invoiceId: "inv_1",
        organisationId: "org-1",
        subscriptionId: "sub_1",
        status: "open",
        amountDue: 1000,
        amountPaid: 0,
        currency: "USD",
        dueDate: null,
        createdAt: null,
      });
    return send({ error: "not found" }, 404);
  });

  const port = await listen(server);
  const lago = new LagoBillingProviderAdapter(`http://127.0.0.1:${port}`);
  const readiness = await lago.readiness();
  const account = await lago.ensureAccount({
    organisationId: "org-1",
    currency: "USD",
    name: "Org 1",
    actorId: "op-1",
  });
  const plan = await lago.syncPlan({
    name: "Pro",
    currency: "USD",
    billingPeriod: "monthly",
    unitAmount: 1000,
    priceType: "flat",
    actorId: "op-1",
  } as never);
  const sub = await lago.createSubscription({
    organisationId: "org-1",
    planId: "plan_1",
    priceId: "price_1",
    externalAccountId: "cust_1",
    actorId: "op-1",
  } as never);
  const cancelled = await lago.cancelSubscription("org-1", "sub_1");
  const invoice = await lago.getInvoice("org-1", "inv_1");
  assert.equal(readiness.status, "ready");
  assert.equal(account.externalAccountId, "cust_1");
  assert.equal(plan.plan.planId, "plan_1");
  assert.equal(sub.status, "active");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(invoice?.invoiceId, "inv_1");
  console.log(
    JSON.stringify({ capability: "V2 lago adapter", result: "PASSED", readiness }, null, 2)
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
