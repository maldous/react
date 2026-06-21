import http from "node:http";
import { strict as assert } from "node:assert";
import {
  HttpBillingProviderAdapter,
  HttpWorkflowOrchestratorAdapter,
  HttpAutomationRunnerAdapter,
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
        organisationId: "org-1",
        currency: "USD",
        createdAt: new Date().toISOString(),
      });
    if (req.method === "POST" && url === "/start") return send({ workflowId: "wf_1" });
    if (req.method === "POST" && url === "/signal") return send({ ok: true });
    if (req.method === "GET" && url === "/status/wf_1")
      return send({ workflowId: "wf_1", status: "waiting", detail: "approved" });
    if (req.method === "POST" && url === "/run-script") return send({ runId: "run_1" });
    if (req.method === "GET" && url === "/run-status/run_1")
      return send({ runId: "run_1", status: "succeeded", detail: "script:tenant.export" });
    return send({ error: "not found" }, 404);
  });

  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const billing = new HttpBillingProviderAdapter(baseUrl);
  const workflow = new HttpWorkflowOrchestratorAdapter(baseUrl);
  const automation = new HttpAutomationRunnerAdapter(baseUrl);

  const readiness = await billing.readiness();
  const account = await billing.ensureAccount({
    organisationId: "org-1",
    currency: "USD",
    name: "Org 1",
    actorId: "op-1",
  });
  const wf = await workflow.startWorkflow({
    workflowKey: "tenant.delete",
    tenantId: "org-1",
    workflowId: "wf_1",
    payload: {},
  });
  await workflow.signalWorkflow(wf.workflowId, "approval.granted", { approvedBy: "op-1" });
  const status = await workflow.getWorkflowStatus(wf.workflowId);
  const run = await automation.runScript({
    scriptKey: "tenant.export",
    tenantId: "org-1",
    runId: "run_1",
    payload: {},
  });
  const runStatus = await automation.getRunStatus(run.runId);

  assert.equal(readiness.status, "ready");
  assert.equal(account.externalAccountId, "acct_1");
  assert.equal(status.status, "waiting");
  assert.equal(runStatus.status, "succeeded");
  console.log(
    JSON.stringify(
      {
        capability: "V2 composed provider runtime closure",
        result: "PASSED",
        readiness,
        status,
        runStatus,
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
