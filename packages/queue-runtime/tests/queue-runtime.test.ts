import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueueError, createInMemoryQueue } from "../src/index.ts";

describe("createInMemoryQueue", () => {
  it("enqueues and returns a job id", async () => {
    const queue = createInMemoryQueue<{ msg: string }>();
    const jobId = await queue.enqueue({ msg: "hello" });
    assert.ok(typeof jobId === "string" && jobId.length > 0);
  });
  it("reports correct size", async () => {
    const queue = createInMemoryQueue<{ n: number }>();
    await queue.enqueue({ n: 1 });
    await queue.enqueue({ n: 2 });
    assert.strictEqual(await queue.size(), 2);
  });
  it("drain processes all jobs and empties queue", async () => {
    const queue = createInMemoryQueue<{ n: number }>();
    await queue.enqueue({ n: 1 });
    await queue.enqueue({ n: 2 });
    const processed: number[] = [];
    await queue.drain(async (job) => {
      processed.push(job.payload.n);
    });
    assert.deepStrictEqual(processed.sort((a, b) => a - b), [1, 2]);
    assert.strictEqual(await queue.size(), 0);
  });
});

describe("QueueError", () => {
  it("is an Error with correct name", () => {
    const err = new QueueError("fail");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "QueueError");
  });
});
