import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StorageError } from "@platform/storage-runtime";
import { S3ObjectStorageAdapter, getStorageOperationMetric } from "../src/index.ts";

describe("S3ObjectStorageAdapter", () => {
  it("constructs without error", () => {
    const adapter = new S3ObjectStorageAdapter({
      bucket: "test-bucket",
      region: "us-east-1",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "minio", secretAccessKey: "minio123" },
    });
    assert.ok(adapter instanceof S3ObjectStorageAdapter);
  });

  it("put delegates to S3Client", async () => {
    const calls: unknown[] = [];
    const before = getStorageOperationMetric("put", "success");
    const fakeClient = {
      send: async (cmd: unknown) => {
        calls.push(cmd);
        return {};
      },
    };
    const adapter = new S3ObjectStorageAdapter(
      { bucket: "test", region: "us-east-1" },
      fakeClient as never
    );
    await adapter.put({ key: "test.txt", body: Buffer.from("hi"), contentType: "text/plain" });
    assert.strictEqual(calls.length, 1);
    assert.equal(
      getStorageOperationMetric("put", "success"),
      before + 1,
      "successful put increments the bounded storage metric"
    );
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
      fakeClient as never
    );
    const result = await adapter.get("missing.txt");
    assert.strictEqual(result, null);
  });

  it("enforces tenant prefix isolation before S3 writes", async () => {
    const fakeClient = {
      send: async () => {
        throw new Error("S3 must not be called for a foreign tenant prefix");
      },
    };
    const adapter = new S3ObjectStorageAdapter(
      { bucket: "test", region: "us-east-1", organisationId: "tenant-a" },
      fakeClient as never
    );

    await assert.rejects(
      () => adapter.put({ key: "tenant-b/file.txt", body: "x", contentType: "text/plain" }),
      /tenant prefix/
    );
  });

  it("enforces tenant prefix isolation before list and signed URL policy", async () => {
    const fakeClient = {
      send: async () => {
        throw new Error("S3 must not be called for a foreign tenant prefix");
      },
    };
    const adapter = new S3ObjectStorageAdapter(
      { bucket: "test", region: "us-east-1", organisationId: "tenant-a" },
      fakeClient as never
    );

    await assert.rejects(() => adapter.list("tenant-b/"), /tenant prefix/);
    await assert.rejects(
      () => adapter.getPresignedUrl({ key: "tenant-b/file.txt", expiresInSeconds: 60 }),
      /tenant prefix/,
      "foreign keys are rejected before a presigned signedUrl with expiresIn TTL can be issued"
    );
  });

  it("maps S3 failures to StorageError and records the error metric", async () => {
    const before = getStorageOperationMetric("delete", "error");
    const fakeClient = {
      send: async () => {
        throw new Error("s3 unavailable");
      },
    };
    const adapter = new S3ObjectStorageAdapter(
      { bucket: "test", region: "us-east-1", organisationId: "tenant-a" },
      fakeClient as never
    );

    await assert.rejects(() => adapter.delete("tenant-a/file.txt"), StorageError);
    assert.equal(
      getStorageOperationMetric("delete", "error"),
      before + 1,
      "failed delete increments the bounded storage error counter"
    );
  });
});
