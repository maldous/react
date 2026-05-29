import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StorageError, createInMemoryObjectStoragePort } from "../src/index.ts";

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
