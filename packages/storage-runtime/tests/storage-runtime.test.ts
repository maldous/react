import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StorageError,
  createInMemoryObjectStoragePort,
  createTenantScopedObjectStoragePort,
  type TenantScopedStoragePolicy,
} from "../src/index.ts";

describe("createInMemoryObjectStoragePort", () => {
  it("round-trips an object", async () => {
    const port = createInMemoryObjectStoragePort();
    await port.put({ key: "test.txt", body: Buffer.from("hello"), contentType: "text/plain" });
    const result = await port.get("test.txt");
    assert.ok(result !== null);
    const text = await new Response(result.body).text();
    assert.strictEqual(text, "hello");
  });
  it("returns null for missing object", async () => {
    const port = createInMemoryObjectStoragePort();
    assert.strictEqual(await port.get("missing.txt"), null);
  });
  it("delete removes the object", async () => {
    const port = createInMemoryObjectStoragePort();
    await port.put({ key: "x.txt", body: Buffer.from("x"), contentType: "text/plain" });
    await port.delete("x.txt");
    assert.strictEqual(await port.get("x.txt"), null);
  });
  it("getPresignedUrl returns a string", async () => {
    const port = createInMemoryObjectStoragePort();
    const url = await port.getPresignedUrl({ key: "file.txt", expiresInSeconds: 60 });
    assert.ok(typeof url === "string" && url.length > 0);
  });
  it("list returns matching entries", async () => {
    const port = createInMemoryObjectStoragePort();
    await port.put({ key: "a/one.txt", body: Buffer.from("1"), contentType: "text/plain" });
    await port.put({ key: "a/two.txt", body: Buffer.from("2"), contentType: "text/plain" });
    await port.put({ key: "b/three.txt", body: Buffer.from("3"), contentType: "text/plain" });
    const items = await port.list("a/");
    assert.strictEqual(items.length, 2);
  });
});

describe("StorageError", () => {
  it("is an Error with correct name", () => {
    const err = new StorageError("fail");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "StorageError");
  });
});

function createPolicy(overrides: Partial<TenantScopedStoragePolicy> = {}) {
  const calls = {
    audit: [] as unknown[],
    trace: [] as string[],
    log: [] as unknown[],
    metric: [] as unknown[],
    quotaChecked: false,
    legalHoldChecked: false,
  };
  const policy: TenantScopedStoragePolicy = {
    organisationId: "tenant-a",
    async quotaBeforeWrite() {
      calls.quotaChecked = true;
    },
    async antivirusScan() {
      return "clean";
    },
    async legalHoldDeletionBlock() {
      calls.legalHoldChecked = true;
    },
    async auditEvent(event) {
      calls.audit.push(event);
    },
    async traceSpan(name, _attributes, run) {
      calls.trace.push(name);
      return run();
    },
    log(_level, fields) {
      calls.log.push(fields);
    },
    metric(name, labels) {
      calls.metric.push({ name, labels });
    },
    ...overrides,
  };
  return { policy, calls };
}

describe("createTenantScopedObjectStoragePort", () => {
  it("enforces tenantPrefix isolation, quota-before-write, AV scan lifecycle, audit, trace, log, and metric", async () => {
    const base = createInMemoryObjectStoragePort();
    const { policy, calls } = createPolicy();
    const port = createTenantScopedObjectStoragePort(base, policy);

    await assert.rejects(
      () => port.put({ key: "tenant-b/file.txt", body: "x", contentType: "text/plain" }),
      /tenantPrefix isolation/
    );
    await port.put({ key: "tenant-a/file.txt", body: "safe", contentType: "text/plain" });
    const object = await port.get("tenant-a/file.txt");

    assert.ok(object);
    assert.equal(calls.quotaChecked, true);
    assert.deepEqual(
      calls.audit.map((event) => (event as { action: string }).action),
      ["storage.object.scan.clean", "storage.object.download"]
    );
    assert.ok(calls.trace.includes("storage.put"));
    assert.ok(calls.trace.includes("storage.download"));
    assert.ok(calls.log.length >= 2, "structured log hooks record storage operations");
    assert.ok(calls.metric.length >= 2, "metric hooks count storage operations");
  });

  it("blocks download and signedUrl policy until a clean scan; rejected lifecycle remains unavailable", async () => {
    const { policy } = createPolicy({ antivirusScan: async () => "rejected" });
    const port = createTenantScopedObjectStoragePort(createInMemoryObjectStoragePort(), policy);

    await port.put({ key: "tenant-a/rejected.txt", body: "bad", contentType: "text/plain" });

    await assert.rejects(() => port.get("tenant-a/rejected.txt"), /blocked until clean/);
    await assert.rejects(
      () => port.getPresignedUrl({ key: "tenant-a/rejected.txt", expiresInSeconds: 60 }),
      /signedUrl policy blocked until clean scan/
    );
  });

  it("checks legal hold before deletion and records delete audit when allowed", async () => {
    const { policy, calls } = createPolicy();
    const port = createTenantScopedObjectStoragePort(createInMemoryObjectStoragePort(), policy);

    await port.put({ key: "tenant-a/delete.txt", body: "safe", contentType: "text/plain" });
    await port.delete("tenant-a/delete.txt");

    assert.equal(calls.legalHoldChecked, true);
    assert.ok(
      calls.audit.some((event) => (event as { action: string }).action === "storage.object.delete")
    );
  });

  it("propagates legal hold deletion block without deleting the object", async () => {
    const { policy } = createPolicy({
      legalHoldDeletionBlock: async () => {
        throw new StorageError("legal hold deletion block");
      },
    });
    const port = createTenantScopedObjectStoragePort(createInMemoryObjectStoragePort(), policy);

    await port.put({ key: "tenant-a/hold.txt", body: "safe", contentType: "text/plain" });
    await assert.rejects(() => port.delete("tenant-a/hold.txt"), /legal hold deletion block/);
    assert.ok(await port.get("tenant-a/hold.txt"));
  });
});
