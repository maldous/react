import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TemporalWorkflowProviderAdapter } from "../../src/adapters/temporal-workflow-provider.ts";

describe("TemporalWorkflowProviderAdapter", () => {
  it("uses the injected SDK path for workflow lifecycle operations", async () => {
    const calls: string[] = [];
    const sdk = {
      Connection: {
        connect: async () => {
          calls.push("Connection.connect");
          return {};
        },
      },
      WorkflowClient: class {
        constructor() {
          calls.push("WorkflowClient.ctor");
        }
        async start(
          workflowKey: string,
          opts: { taskQueue: string; workflowId: string; args: unknown[] }
        ) {
          calls.push(`start:${workflowKey}:${opts.workflowId}:${opts.taskQueue}`);
          return { workflowId: opts.workflowId };
        }
        getHandle(workflowId: string) {
          calls.push(`getHandle:${workflowId}`);
          return {
            signal: async (signalName: string, payload: unknown) => {
              calls.push(`signal:${signalName}:${JSON.stringify(payload)}`);
            },
            cancel: async () => {
              calls.push(`cancel:${workflowId}`);
            },
            describe: async () => {
              calls.push(`describe:${workflowId}`);
              return { status: { name: "Running" } };
            },
          };
        }
      },
    };

    const adapter = new TemporalWorkflowProviderAdapter("http://temporal.local", {
      preferSdk: true,
      fetchImpl: fetch,
    });

    (adapter as unknown as { sdkPromise: Promise<unknown> | null }).sdkPromise = Promise.resolve(
      sdk as never
    );

    const started = await adapter.startWorkflow({
      workflowKey: "tenant.delete",
      tenantId: "tenant-a",
      workflowId: "wf-1",
      payload: { tenantId: "tenant-a" },
    });
    await adapter.signalWorkflow("wf-1", "approval.requested", { requestedBy: "operator-1" });
    await adapter.cancelWorkflow("wf-1");
    const status = await adapter.getWorkflowStatus("wf-1");

    assert.equal(started.workflowId, "wf-1");
    assert.equal(status.status, "running");
    assert.deepEqual(calls, [
      "Connection.connect",
      "WorkflowClient.ctor",
      "start:tenant.delete:wf-1:tenant.delete",
      "Connection.connect",
      "WorkflowClient.ctor",
      "getHandle:wf-1",
      'signal:approval.requested:{"requestedBy":"operator-1"}',
      "Connection.connect",
      "WorkflowClient.ctor",
      "getHandle:wf-1",
      "cancel:wf-1",
      "Connection.connect",
      "WorkflowClient.ctor",
      "getHandle:wf-1",
      "describe:wf-1",
    ]);
  });
});
