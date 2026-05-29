import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SentryErrorAdapter, createSentryAdapter } from "../src/index.ts";

describe("SentryErrorAdapter", () => {
  it("constructs without error when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    assert.ok(adapter instanceof SentryErrorAdapter);
  });

  it("captureError returns undefined when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    const result = adapter.captureError(new Error("test error"));
    assert.strictEqual(result, undefined);
  });

  it("captureMessage returns undefined when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    const result = adapter.captureMessage("test message", "warning");
    assert.strictEqual(result, undefined);
  });

  it("setUser does not throw when disabled", () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    assert.doesNotThrow(() => adapter.setUser({ id: "user-1", email: "u@a.com" }));
  });

  it("flush returns true when disabled", async () => {
    const adapter = createSentryAdapter({ dsn: "", environment: "test", enabled: false });
    const result = await adapter.flush();
    assert.strictEqual(result, true);
  });
});
