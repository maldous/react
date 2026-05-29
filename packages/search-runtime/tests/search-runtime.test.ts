import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchError, createInMemorySearchPort } from "../src/index.ts";

describe("createInMemorySearchPort", () => {
  it("indexes and finds documents", async () => {
    const port = createInMemorySearchPort<{ id: string; name: string }>();
    await port.index({ id: "1", name: "Alice" });
    await port.index({ id: "2", name: "Bob" });
    const result = await port.search({ q: "alice" });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]!.name, "Alice");
  });
  it("returns empty when no match", async () => {
    const port = createInMemorySearchPort<{ id: string; title: string }>();
    await port.index({ id: "1", title: "Hello World" });
    const result = await port.search({ q: "xyz" });
    assert.strictEqual(result.items.length, 0);
  });
  it("delete removes from index", async () => {
    const port = createInMemorySearchPort<{ id: string; label: string }>();
    await port.index({ id: "1", label: "foo" });
    await port.delete("1");
    const result = await port.search({ q: "foo" });
    assert.strictEqual(result.items.length, 0);
  });
  it("bulk indexes multiple documents", async () => {
    const port = createInMemorySearchPort<{ id: string; tag: string }>();
    await port.bulk([
      { id: "a", tag: "alpha" },
      { id: "b", tag: "beta" },
    ]);
    const result = await port.search({ q: "alpha" });
    assert.strictEqual(result.items.length, 1);
  });
});

describe("SearchError", () => {
  it("is an Error with correct name", () => {
    const err = new SearchError("fail");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "SearchError");
  });
});
