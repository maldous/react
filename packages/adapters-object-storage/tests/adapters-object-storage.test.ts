import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { S3ObjectStorageAdapter } from "../src/index.ts";

describe("S3ObjectStorageAdapter", () => {
  it("constructs without error", () => {
    const adapter = new S3ObjectStorageAdapter({
      bucket: "test-bucket",
      region: "us-east-1",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "minio", secretAccessKey: "minio123" },
    });
    assert.ok(adapter !== null);
  });

  it("put delegates to S3Client", async () => {
    const calls: unknown[] = [];
    const fakeClient = { send: async (cmd: unknown) => { calls.push(cmd); return {}; } };
    const adapter = new S3ObjectStorageAdapter(
      { bucket: "test", region: "us-east-1" },
      fakeClient as never,
    );
    await adapter.put({ key: "test.txt", body: Buffer.from("hi"), contentType: "text/plain" });
    assert.strictEqual(calls.length, 1);
  });

  it("get returns null when S3 throws NoSuchKey", async () => {
    const fakeClient = {
      send: async () => {
        const err = new Error("not found");
        err.name = "NoSuchKey";
        throw err;
      },
    };
    const adapter = new S3ObjectStorageAdapter(
      { bucket: "test", region: "us-east-1" },
      fakeClient as never,
    );
    const result = await adapter.get("missing.txt");
    assert.strictEqual(result, null);
  });
});
