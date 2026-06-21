import { strict as assert } from "node:assert";
import {
  InMemoryBillingProvider,
  InMemoryPaymentProvider,
} from "../src/adapters/in-memory-billing-provider.ts";

async function main(): Promise<void> {
  const billing = new InMemoryBillingProvider();
  const payment = new InMemoryPaymentProvider();
  const readiness = await billing.readiness();
  assert.equal(readiness.status, "ready");
  const account = await billing.ensureAccount({
    organisationId: "org-billing-proof",
    currency: "USD",
    name: "Proof Org",
    actorId: "operator-1",
  });
  const charge = await payment.charge({
    organisationId: "org-billing-proof",
    invoiceId: "inv_1",
    amount: 100,
    currency: "USD",
    paymentMethodToken: "pm_test",
    idempotencyKey: "idemp-1",
  });
  const refund = await payment.refund(charge.chargeId, 50, "operator-1");
  assert.equal(account.organisationId, "org-billing-proof");
  assert.equal(charge.outcome, "succeeded");
  assert.equal(refund.succeeded, true);
  console.log(
    JSON.stringify(
      { capability: "V2 billing provider adapter", result: "PASSED", readiness },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
