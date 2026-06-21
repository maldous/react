import http from "node:http";
import { strict as assert } from "node:assert";
import {
  HttpAutomationRunnerAdapter,
  HttpBillingProviderAdapter,
  HttpPaymentProviderAdapter,
  HttpWorkflowOrchestratorAdapter,
} from "../src/adapters/http-engine-provider.ts";

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
    if (req.method === "POST" && url === "/accounts")
      return send({
        externalAccountId: "acct_1",
        organisationId: "org",
        currency: "USD",
        createdAt: new Date().toISOString(),
      });
    if (req.method === "GET" && url.startsWith("/accounts/"))
      return send({
        externalAccountId: "acct_1",
        organisationId: "org",
        currency: "USD",
        createdAt: null,
      });
    if (req.method === "POST" && url === "/charges")
      return send({ chargeId: "ch_1", outcome: "succeeded", failureReason: null });
    if (req.method === "POST" && url === "/refunds")
      return send({ refundId: "rf_1", amountRefunded: 50, succeeded: true });
    if (req.method === "POST" && url === "/start") return send({ workflowId: "wf_1" });
    if (req.method === "POST" && url === "/signal") return send({ ok: true });
    if (req.method === "POST" && url === "/cancel") return send({ ok: true });
    if (req.method === "GET" && url === "/status/wf_1")
      return send({ workflowId: "wf_1", status: "running", detail: "ok" });
    if (req.method === "POST" && url === "/run-script") return send({ runId: "run_1" });
    if (req.method === "POST" && url === "/run-flow") return send({ runId: "run_2" });
    if (req.method === "GET" && url === "/run-status/run_1")
      return send({ runId: "run_1", status: "succeeded", detail: "ok" });
    if (req.method === "POST" && url === "/cancel-run") return send({ ok: true });
    return send({ error: "not found" }, 404);
  });

  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const billing = new HttpBillingProviderAdapter(baseUrl);
  const payment = new HttpPaymentProviderAdapter(baseUrl);
  const workflow = new HttpWorkflowOrchestratorAdapter(baseUrl);
  const automation = new HttpAutomationRunnerAdapter(baseUrl);

  const r1 = await billing.readiness();
  assert.equal(r1.status, "ready");
  const account = await billing.ensureAccount({
    organisationId: "org",
    currency: "USD",
    name: "Org",
    actorId: "op",
  });
  const charge = await payment.charge({
    organisationId: "org",
    invoiceId: "inv",
    amount: 100,
    currency: "USD",
    paymentMethodToken: "pm",
    idempotencyKey: "key-1",
  });
  const wf = await workflow.startWorkflow({
    workflowKey: "tenant.delete",
    tenantId: "org",
    workflowId: "wf_1",
    payload: {},
  });
  const status = await workflow.getWorkflowStatus(wf.workflowId);
  const run = await automation.runScript({
    scriptKey: "tenant.export",
    tenantId: "org",
    runId: "run_1",
    payload: {},
  });
  const runStatus = await automation.getRunStatus(run.runId);
  assert.equal(account.externalAccountId, "acct_1");
  assert.equal(charge.outcome, "succeeded");
  assert.equal(status.status, "running");
  assert.equal(runStatus.status, "succeeded");
  console.log(
    JSON.stringify(
      {
        capability: "V2 http engine adapters",
        result: "PASSED",
        baseUrl,
      },
      null,
      2
    )
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
