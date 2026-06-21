import http from "node:http";
import { strict as assert } from "node:assert";
import { TemporalWorkflowProviderAdapter } from "../src/adapters/temporal-workflow-provider.ts";

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
    if (req.method === "POST" && url === "/api/workflows/start")
      return send({ workflowId: "wf_1" });
    if (req.method === "POST" && url === "/api/workflows/wf_1/signal") return send({ ok: true });
    if (req.method === "POST" && url === "/api/workflows/wf_1/cancel") return send({ ok: true });
    if (req.method === "GET" && url === "/api/workflows/wf_1")
      return send({ workflowId: "wf_1", status: "waiting", detail: "approved" });
    return send({ error: "not found" }, 404);
  });

  const port = await listen(server);
  const temporal = new TemporalWorkflowProviderAdapter(`http://127.0.0.1:${port}`);
  const started = await temporal.startWorkflow({
    workflowKey: "tenant.delete",
    tenantId: "org-1",
    workflowId: "wf_1",
    payload: {},
  });
  await temporal.signalWorkflow(started.workflowId, "approval.granted", { approvedBy: "op" });
  const status = await temporal.getWorkflowStatus(started.workflowId);
  assert.equal(status.status, "waiting");
  await temporal.cancelWorkflow(started.workflowId);
  console.log(
    JSON.stringify(
      {
        capability: "V2 temporal adapter",
        result: "PASSED",
        status,
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
