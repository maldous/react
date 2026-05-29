import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createObservability } from "../src/index.ts";

describe("createObservability", () => {
  it("creates without error", () => {
    const obs = createObservability({ serviceName: "test-service", serviceVersion: "1.0.0" });
    assert.ok(obs.logger !== undefined);
    assert.ok(obs.tracer !== undefined);
    assert.ok(typeof obs.withSpan === "function");
    assert.ok(typeof obs.child === "function");
  });

  it("withSpan executes callback and returns result", async () => {
    const obs = createObservability({ serviceName: "test", serviceVersion: "0.1" });
    const result = await obs.withSpan("test-span", async () => 42);
    assert.strictEqual(result, 42);
  });

  it("child returns an ObservabilityService", () => {
    const obs = createObservability({ serviceName: "test", serviceVersion: "0.1" });
    const child = obs.child({ requestId: "req-1" });
    assert.ok(child.logger !== undefined);
    assert.ok(typeof child.withSpan === "function");
  });

  it("withSpan propagates errors", async () => {
    const obs = createObservability({ serviceName: "test", serviceVersion: "0.1" });
    await assert.rejects(
      () => obs.withSpan("fail-span", async () => { throw new Error("boom"); }),
      { message: "boom" },
    );
  });
});
