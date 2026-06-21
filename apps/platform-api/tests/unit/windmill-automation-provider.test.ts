import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WindmillAutomationProviderAdapter } from "../../src/adapters/windmill-automation-provider.ts";

describe("WindmillAutomationProviderAdapter", () => {
  it("uses the injected SDK path for run, status and cancel", async () => {
    const calls: string[] = [];
    const sdk = {
      setClient: (_token: string | undefined, _baseUrl: string) => {
        calls.push("setClient");
      },
      JobService: {
        runScriptByPath: async (input: {
          workspace: string;
          path: string;
          requestBody: unknown;
          jobId: string;
        }) => {
          calls.push(`runScriptByPath:${input.workspace}:${input.path}:${input.jobId}`);
          return input.jobId;
        },
        runFlowByPath: async (input: {
          workspace: string;
          path: string;
          requestBody: unknown;
          jobId: string;
        }) => {
          calls.push(`runFlowByPath:${input.workspace}:${input.path}:${input.jobId}`);
          return input.jobId;
        },
        getJob: async (input: { workspace: string; id: string }) => {
          calls.push(`getJob:${input.workspace}:${input.id}`);
          return { status: "running" };
        },
        cancelQueuedJob: async (input: { workspace: string; id: string; requestBody: unknown }) => {
          calls.push(`cancelQueuedJob:${input.workspace}:${input.id}`);
        },
      },
    };

    const adapter = new WindmillAutomationProviderAdapter("http://windmill.local", fetch, {
      token: "token",
      preferSdk: true,
    });

    (adapter as unknown as { clientPromise: Promise<unknown> | null }).clientPromise =
      Promise.resolve(sdk as never);

    const run = await adapter.runScript({
      scriptKey: "tenant.export",
      tenantId: "tenant-a",
      runId: "run-1",
      payload: {},
    });
    const status = await adapter.getRunStatus(run.runId);
    await adapter.cancelRun(run.runId);

    assert.equal(run.runId, "run-1");
    assert.equal(status.status, "running");
    assert.deepEqual(calls, [
      "runScriptByPath:tenant-a:tenant.export:run-1",
      "getJob:tenant-a:run-1",
      "cancelQueuedJob:tenant-a:run-1",
    ]);
  });
});
