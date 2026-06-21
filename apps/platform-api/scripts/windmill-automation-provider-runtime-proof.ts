import http from "node:http";
import { strict as assert } from "node:assert";
import { WindmillAutomationProviderAdapter } from "../src/adapters/windmill-automation-provider.ts";

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
    if (req.method === "POST" && url === "/api/run-script") return send({ runId: "run_1" });
    if (req.method === "POST" && url === "/api/run-flow") return send({ runId: "run_2" });
    if (req.method === "GET" && url === "/api/runs/run_1")
      return send({ runId: "run_1", status: "succeeded", detail: "script:tenant.export" });
    if (req.method === "GET" && url === "/api/runs/run_2")
      return send({ runId: "run_2", status: "running", detail: "flow:tenant.onboard" });
    if (req.method === "POST" && url === "/api/runs/run_2/cancel") return send({ ok: true });
    return send({ error: "not found" }, 404);
  });

  const port = await listen(server);
  const windmill = new WindmillAutomationProviderAdapter(`http://127.0.0.1:${port}`);
  const scriptRun = await windmill.runScript({
    scriptKey: "tenant.export",
    tenantId: "org-1",
    runId: "run_1",
    payload: { export: true },
  });
  const flowRun = await windmill.runFlow({
    scriptKey: "tenant.onboard",
    tenantId: "org-1",
    runId: "run_2",
    payload: { approvalRequired: true },
  });
  const scriptStatus = await windmill.getRunStatus(scriptRun.runId);
  await windmill.cancelRun(flowRun.runId);
  const cancelledStatus = await windmill.getRunStatus(flowRun.runId);
  assert.equal(scriptStatus.status, "succeeded");
  assert.equal(cancelledStatus.status, "running");
  console.log(
    JSON.stringify(
      {
        capability: "V2 windmill adapter",
        result: "PASSED",
        scriptStatus,
        cancelledStatus,
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
