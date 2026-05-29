import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createConsoleObservabilityPort } from "../src/index.ts";

describe("createConsoleObservabilityPort", () => {
  it("creates without error", () => {
    const obs = createConsoleObservabilityPort({ service: "test" });
    assert.ok(obs.logger !== undefined);
    assert.ok(typeof obs.withSpan === "function");
    assert.ok(typeof obs.child === "function");
  });

  it("withSpan executes callback and returns result", async () => {
    const obs = createConsoleObservabilityPort();
    const result = await obs.withSpan("test-span", async () => 42);
    assert.strictEqual(result, 42);
  });

  it("withSpan propagates errors", async () => {
    const obs = createConsoleObservabilityPort();
    await assert.rejects(
      () =>
        obs.withSpan("fail-span", async () => {
          throw new Error("boom");
        }),
      { message: "boom" }
    );
  });

  it("child returns an ObservabilityPort with additional fields", () => {
    const obs = createConsoleObservabilityPort();
    const child = obs.child({ requestId: "req-1" });
    assert.ok(typeof child.withSpan === "function");
    assert.ok(child.logger !== undefined);
  });

  it("logger methods are callable", () => {
    const obs = createConsoleObservabilityPort();
    assert.doesNotThrow(() => obs.logger.info("hello", { key: "val" }));
    assert.doesNotThrow(() => obs.logger.warn("warning"));
    assert.doesNotThrow(() => obs.logger.error("error"));
  });
});
