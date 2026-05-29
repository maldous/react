import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PageViewEventSchema, TrackEventSchema, IdentifyEventSchema, AnalyticsEventSchema } from "../src/index.ts";

const NOW = new Date().toISOString();

describe("PageViewEventSchema", () => {
  it("parses a valid page view", () => {
    const result = PageViewEventSchema.safeParse({
      type: "page_view",
      userId: "user-1",
      anonymousId: null,
      page: "/dashboard",
      referrer: null,
      timestamp: NOW,
    });
    assert.ok(result.success);
  });
  it("rejects missing page field", () => {
    const result = PageViewEventSchema.safeParse({ type: "page_view", timestamp: NOW, userId: null, anonymousId: null, referrer: null });
    assert.ok(!result.success);
  });
});

describe("TrackEventSchema", () => {
  it("parses a valid track event", () => {
    const result = TrackEventSchema.safeParse({
      type: "track",
      event: "button_clicked",
      userId: "user-1",
      anonymousId: null,
      properties: { buttonId: "submit" },
      timestamp: NOW,
    });
    assert.ok(result.success);
    assert.strictEqual(result.data?.event, "button_clicked");
  });
  it("defaults properties to empty object", () => {
    const result = TrackEventSchema.safeParse({ type: "track", event: "click", userId: null, anonymousId: null, timestamp: NOW });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data?.properties, {});
  });
});

describe("IdentifyEventSchema", () => {
  it("parses a valid identify event", () => {
    const result = IdentifyEventSchema.safeParse({
      type: "identify",
      userId: "user-1",
      anonymousId: null,
      traits: { name: "Alice" },
      timestamp: NOW,
    });
    assert.ok(result.success);
  });
});

describe("AnalyticsEventSchema discriminated union", () => {
  it("dispatches to correct schema by type", () => {
    const result = AnalyticsEventSchema.safeParse({ type: "track", event: "ev", userId: null, anonymousId: null, timestamp: NOW });
    assert.ok(result.success);
    assert.strictEqual(result.data?.type, "track");
  });
  it("rejects unknown type", () => {
    const result = AnalyticsEventSchema.safeParse({ type: "unknown", timestamp: NOW });
    assert.ok(!result.success);
  });
});
