import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IngestionPayloadSchema, NormalizedRecordSchema } from "../src/index.ts";

const NOW = new Date().toISOString();

describe("IngestionPayloadSchema", () => {
  it("accepts valid payload", () => {
    const result = IngestionPayloadSchema.safeParse({
      source: "webhook",
      sourceId: "wh-123",
      receivedAt: NOW,
      data: { key: "value" },
    });
    assert.ok(result.success);
  });
  it("rejects invalid source", () => {
    const result = IngestionPayloadSchema.safeParse({ source: "fax", sourceId: "1", receivedAt: NOW, data: {} });
    assert.ok(!result.success);
  });
  it("rejects missing data", () => {
    const result = IngestionPayloadSchema.safeParse({ source: "api", sourceId: "1", receivedAt: NOW });
    assert.ok(!result.success);
  });
});

describe("NormalizedRecordSchema", () => {
  it("accepts valid normalized record", () => {
    const result = NormalizedRecordSchema.safeParse({
      id: "rec-1",
      source: "api",
      sourceId: "s-1",
      receivedAt: NOW,
      normalizedAt: NOW,
      data: { x: 1 },
    });
    assert.ok(result.success);
    assert.strictEqual(result.data?.version, 1);
  });
});
