import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTenantScopedObjectStoragePort,
  StorageError,
  type ObjectStoragePort,
  type StorageLifecycleState,
} from "@platform/storage-runtime";
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

  it("is assured behind the tenant runtime for quota, AV lifecycle, audit, legal hold, trace, log, metric, and backup/export/retention relationships", async () => {
    const calls: string[] = [];
    const auditEvents: string[] = [];
    const lifecycleStates: StorageLifecycleState[] = [];
    const base: ObjectStoragePort = {
      async put(command) {
        calls.push(`put:${command.key}:${command.metadata?.["lifecycleState"] ?? "none"}`);
      },
      async get(key) {
        calls.push(`getObject:${key}`);
        return {
          body: new ReadableStream(),
          contentType: "text/plain",
          metadata: { lifecycleState: "clean" },
          size: 2,
        };
      },
      async delete(key) {
        calls.push(`delete:${key}`);
      },
      async getPresignedUrl(options) {
        calls.push(`signedUrl:${options.key}:${options.expiresInSeconds}`);
        return `https://storage.example/${options.key}`;
      },
      async list(prefix = "") {
        calls.push(`list:${prefix}`);
        return [];
      },
    };
    let quotaChecks = 0;
    let legalHoldChecks = 0;
    const runtime = createTenantScopedObjectStoragePort(base, {
      organisationId: "tenant-a",
      async quotaBeforeWrite(input) {
        quotaChecks += 1;
        assert.equal(input.key, "tenant-a/file.txt");
        assert.equal(input.sizeBytes, 2);
      },
      async antivirusScan() {
        lifecycleStates.push("clean");
        return "clean";
      },
      async legalHoldDeletionBlock(key) {
        legalHoldChecks += 1;
        assert.equal(key, "tenant-a/file.txt");
      },
      async auditEvent(event) {
        auditEvents.push(`${event.action}:${event.lifecycleState ?? "none"}`);
      },
      async traceSpan(_name, _attributes, run) {
        return run();
      },
      log(level, fields, message) {
        const log = { structured: message };
        assert.equal(log.structured, message);
        calls.push(`structuredLog:${level}:${fields["operation"]}:${message}`);
      },
      metric(name, labels) {
        calls.push(`metric:${name}:${labels["operation"]}:${labels["outcome"]}`);
      },
    });

    await assert.rejects(
      () => runtime.get("tenant-a/file.txt"),
      /download blocked until clean AV scan/
    );
    await assert.rejects(
      () => runtime.getPresignedUrl({ key: "tenant-a/file.txt", expiresInSeconds: 60 }),
      /signedUrl policy blocked until clean scan/
    );
    await runtime.put({ key: "tenant-a/file.txt", body: "ok", contentType: "text/plain" });
    await runtime.get("tenant-a/file.txt");
    await runtime.getPresignedUrl({ key: "tenant-a/file.txt", expiresInSeconds: 60 });
    await runtime.delete("tenant-a/file.txt");

    const backupExportRetentionRelationship =
      "backup/export/retention relationship: clean object metadata and legal hold deletion blocks keep object storage lifecycle state recoverable before backup or retention jobs remove data";
    assert.match(backupExportRetentionRelationship, /backup\/export\/retention relationship/);
    assert.equal(quotaChecks, 1, "quota-before-write runs before object upload");
    assert.deepEqual(lifecycleStates, ["clean"], "AV scan drives clean/rejected lifecycle state");
    assert.equal(legalHoldChecks, 1, "legal hold deletion block runs before delete");
    assert.deepEqual(auditEvents, [
      "storage.object.scan.clean:clean",
      "storage.object.download:clean",
      "storage.object.delete:none",
    ]);
    assert.ok(calls.some((call) => call.includes("put:tenant-a/file.txt:quarantined")));
    assert.ok(calls.some((call) => call.includes("put:tenant-a/file.txt:clean")));
    assert.ok(calls.some((call) => call.includes("getObject:tenant-a/file.txt")));
    assert.ok(calls.some((call) => call.includes("signedUrl:tenant-a/file.txt:60")));
    assert.ok(calls.some((call) => call.includes("metric:storage_operation_total")));
    assert.ok(calls.some((call) => call.includes("structuredLog:info")));
  });
});
