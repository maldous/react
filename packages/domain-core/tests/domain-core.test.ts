import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createId,
  createTimestamp,
  createPaginationMeta,
  createSliceResult,
  isValidId,
  createDomainEvent,
} from "../src/index.ts";

describe("createId", () => {
  it("returns a non-empty string", () => {
    const id = createId();
    assert.ok(typeof id === "string" && id.length > 0);
  });
  it("returns unique values", () => {
    assert.notStrictEqual(createId(), createId());
  });
});

describe("isValidId", () => {
  it("accepts a valid uuid", () => {
    assert.ok(isValidId(createId()));
  });
  it("rejects empty string", () => {
    assert.ok(!isValidId(""));
  });
  it("rejects non-string", () => {
    assert.ok(!isValidId(42));
  });
});

describe("createTimestamp", () => {
  it("returns an ISO string", () => {
    const ts = createTimestamp();
    assert.ok(!isNaN(Date.parse(ts)));
  });
});

describe("createPaginationMeta", () => {
  it("calculates pages correctly", () => {
    const meta = createPaginationMeta({ total: 25, page: 2, limit: 10 });
    assert.strictEqual(meta.totalPages, 3);
    assert.strictEqual(meta.hasNextPage, true);
    assert.strictEqual(meta.hasPreviousPage, true);
  });
  it("last page has no next", () => {
    const meta = createPaginationMeta({ total: 25, page: 3, limit: 10 });
    assert.strictEqual(meta.hasNextPage, false);
  });
  it("first page has no previous", () => {
    const meta = createPaginationMeta({ total: 25, page: 1, limit: 10 });
    assert.strictEqual(meta.hasPreviousPage, false);
  });
  it("handles zero total", () => {
    const meta = createPaginationMeta({ total: 0, page: 1, limit: 10 });
    assert.strictEqual(meta.totalPages, 1);
    assert.strictEqual(meta.hasNextPage, false);
  });
});

describe("createSliceResult", () => {
  it("wraps items with meta", () => {
    const result = createSliceResult({ items: [1, 2], total: 10, page: 1, limit: 2 });
    assert.deepStrictEqual(result.items, [1, 2]);
    assert.strictEqual(result.meta.total, 10);
    assert.strictEqual(result.meta.totalPages, 5);
  });
});

describe("createDomainEvent", () => {
  it("creates an event with required fields", () => {
    const aggId = createId();
    const event = createDomainEvent({
      type: "user.created",
      payload: { email: "a@b.com" },
      aggregateId: aggId,
      aggregateType: "User",
    });
    assert.ok(typeof event.id === "string");
    assert.ok(typeof event.timestamp === "string");
    assert.strictEqual(event.type, "user.created");
    assert.strictEqual(event.aggregateId, aggId);
  });
});
