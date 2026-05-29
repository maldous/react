import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OtelSdkAdapter, createOtelSdkAdapter } from "../src/index.ts";

describe("OtelSdkAdapter", () => {
  it("constructs without error", () => {
    const adapter = createOtelSdkAdapter({
      serviceName: "test-service",
      serviceVersion: "0.1.0",
      enabled: false,
    });
    assert.ok(adapter instanceof OtelSdkAdapter);
  });

  it("isEnabled returns false when disabled", () => {
    const adapter = createOtelSdkAdapter({ serviceName: "s", serviceVersion: "1", enabled: false });
    assert.strictEqual(adapter.isEnabled(), false);
  });

  it("isEnabled returns true when enabled", () => {
    const adapter = createOtelSdkAdapter({ serviceName: "s", serviceVersion: "1", enabled: true });
    assert.strictEqual(adapter.isEnabled(), true);
  });

  it("getTracer returns a tracer object", () => {
    const adapter = createOtelSdkAdapter({
      serviceName: "svc",
      serviceVersion: "1.0",
      enabled: false,
    });
    const tracer = adapter.getTracer();
    assert.ok(tracer !== null && typeof tracer === "object");
  });

  it("shutdown resolves without error", async () => {
    const adapter = createOtelSdkAdapter({ serviceName: "s", serviceVersion: "1", enabled: false });
    await assert.doesNotReject(() => adapter.shutdown());
  });
});
