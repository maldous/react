import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkerError, createInMemoryWorkerPort } from "../src/index.ts";

describe("createInMemoryWorkerPort", () => {
  it("schedules a task and returns an id", async () => {
    const port = createInMemoryWorkerPort();
    const id = await port.schedule({ name: "send-email", payload: { to: "a@b.com" } });
    assert.ok(typeof id === "string" && id.length > 0);
  });
  it("status returns scheduled for new task", async () => {
    const port = createInMemoryWorkerPort();
    const id = await port.schedule({ name: "my-task", payload: {} });
    const status = await port.status(id);
    assert.strictEqual(status, "scheduled");
  });
  it("cancel changes status to cancelled", async () => {
    const port = createInMemoryWorkerPort();
    const id = await port.schedule({ name: "my-task", payload: {} });
    await port.cancel(id);
    const status = await port.status(id);
    assert.strictEqual(status, "cancelled");
  });
  it("status returns null for unknown task", async () => {
    const port = createInMemoryWorkerPort();
    const status = await port.status("unknown-id");
    assert.strictEqual(status, null);
  });
});

describe("WorkerError", () => {
  it("is an Error with correct name", () => {
    const err = new WorkerError("fail");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "WorkerError");
  });
});
