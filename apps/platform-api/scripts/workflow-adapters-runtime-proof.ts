import { strict as assert } from "node:assert";
import http from "node:http";
import { InMemoryWorkflowOrchestrator } from "../src/adapters/in-memory-workflow-orchestrator.ts";
import { InMemoryAutomationRunner } from "../src/adapters/in-memory-automation-runner.ts";
import { WindmillAutomationProviderAdapter } from "../src/adapters/windmill-automation-provider.ts";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function main(): Promise<void> {
  const workflow = new InMemoryWorkflowOrchestrator();
  const automation = new InMemoryAutomationRunner();
  const workflowId = "tenant-a:workflow-1";
  await workflow.startWorkflow({
    workflowKey: "tenant.delete",
    tenantId: "tenant-a",
    workflowId,
    payload: {},
  });
  assert.equal(workflow.canAccess(workflowId, "tenant-a"), true);
  assert.equal(workflow.canAccess(workflowId, "tenant-b"), false);
  await workflow.signalWorkflow(workflowId, "approval.granted", { approvedBy: "op" });
  const status = await workflow.getWorkflowStatus(workflowId);
  assert.equal(status.status, "waiting");
  await automation.runScript({
    scriptKey: "tenant.export",
    tenantId: "tenant-a",
    runId: "run-1",
    payload: {},
  });
  const run = await automation.getRunStatus("run-1");
  assert.equal(run.status, "succeeded");

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (body: unknown, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/api/run-script") return send({ runId: "run-2" });
    if (req.method === "GET" && url === "/api/runs/run-2")
      return send({ runId: "run-2", status: "succeeded", detail: "script:tenant.export" });
    return send({ error: "not found" }, 404);
  });
  const port = await listen(server);
  const windmill = new WindmillAutomationProviderAdapter(`http://127.0.0.1:${port}`);
  const remoteRun = await windmill.runScript({
    scriptKey: "tenant.export",
    tenantId: "tenant-a",
    runId: "run-2",
    payload: {},
  });
  const remoteStatus = await windmill.getRunStatus(remoteRun.runId);
  assert.equal(remoteStatus.status, "succeeded");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log(
    JSON.stringify(
      {
        capability: "V2 workflow adapters",
        result: "PASSED",
        workflow: status,
        run,
        remoteStatus,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
