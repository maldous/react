import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SentryErrorAdapter, createSentryAdapter, correlationTagsFrom } from "../src/index.ts";

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

// ADR-ACT-0285 Phase 5.5 — the producer enrichment that makes a captured event
// searchable in the Sentry API by the same correlation ids the log line carries.
describe("correlationTagsFrom", () => {
  it("promotes requestId/testRunId/scenarioId to searchable tags", () => {
    const tags = correlationTagsFrom({
      requestId: "req-1",
      testRunId: "trid-1",
      scenarioId: "scn-1",
    });
    assert.deepEqual(tags, { requestId: "req-1", testRunId: "trid-1", scenarioId: "scn-1" });
  });

  it("ignores non-correlation keys and empty/non-string values", () => {
    const tags = correlationTagsFrom({
      requestId: "req-1",
      tenantId: "should-not-leak",
      testRunId: "",
      scenarioId: 42 as unknown as string,
    });
    assert.deepEqual(tags, { requestId: "req-1" });
  });

  it("returns an empty object for missing context", () => {
    assert.deepEqual(correlationTagsFrom(undefined), {});
    assert.deepEqual(correlationTagsFrom({}), {});
  });
});
