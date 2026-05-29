import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpIngestionAdapter } from "../src/index.ts";

const NOW = new Date().toISOString();

describe("HttpIngestionAdapter", () => {
  it("accepts a valid payload", async () => {
    const adapter = new HttpIngestionAdapter({ validate: true });
    const result = await adapter.ingest({
      source: "webhook",
      sourceId: "wh-1",
      receivedAt: NOW,
      data: { event: "test" },
    });
    assert.strictEqual(result.status, "accepted");
    assert.ok(typeof result.recordId === "string" && result.recordId.length > 0);
  });

  it("rejects an invalid source", async () => {
    const adapter = new HttpIngestionAdapter({ validate: true });
    const result = await adapter.ingest({
      source: "fax",
      sourceId: "1",
      receivedAt: NOW,
      data: {},
    });
    assert.strictEqual(result.status, "rejected");
    assert.ok(typeof result.reason === "string");
  });

  it("uses custom normalizer", async () => {
    const adapter = new HttpIngestionAdapter({
      validate: true,
      normalizer: (payload) => ({
        id: "custom-id",
        source: payload.source,
        sourceId: payload.sourceId,
        receivedAt: payload.receivedAt,
        normalizedAt: NOW,
        data: payload.data,
        version: 2,
      }),
    });
    const result = await adapter.ingest({
      source: "api",
      sourceId: "s1",
      receivedAt: NOW,
      data: {},
    });
    assert.strictEqual(result.status, "accepted");
    assert.strictEqual(result.recordId, "custom-id");
  });

  it("skips validation when disabled", async () => {
    const adapter = new HttpIngestionAdapter({ validate: false });
    const result = await adapter.ingest({
      source: "api",
      sourceId: "s1",
      receivedAt: NOW,
      data: {},
    });
    assert.strictEqual(result.status, "accepted");
  });
});
