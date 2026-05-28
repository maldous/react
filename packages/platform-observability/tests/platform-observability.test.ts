import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTracer,
  withSpan,
  withSpanSync,
  getTraceContext,
  recordException,
  setSpanAttributes,
} from "../src/index.ts";

describe("createTracer", () => {
  it("returns a Tracer object", () => {
    const tracer = createTracer("test-service");
    assert.ok(tracer !== null && tracer !== undefined);
    assert.equal(typeof tracer.startSpan, "function");
  });

  it("accepts an optional version", () => {
    const tracer = createTracer("test-service", "1.0.0");
    assert.ok(tracer !== null && tracer !== undefined);
  });
});

describe("withSpan", () => {
  it("executes the callback and returns its result", async () => {
    const tracer = createTracer("test-with-span");
    const result = await withSpan(tracer, "test-operation", (_span) => {
      return 42;
    });
    assert.equal(result, 42);
  });

  it("works with an async callback", async () => {
    const tracer = createTracer("test-with-span-async");
    const result = await withSpan(tracer, "async-operation", async (_span) => {
      return "async-result";
    });
    assert.equal(result, "async-result");
  });

  it("ends the span after the callback completes", async () => {
    const tracer = createTracer("test-span-end");
    let spanEnded = false;
    await withSpan(tracer, "end-test", (span) => {
      const originalEnd = span.end.bind(span);
      span.end = (...args: Parameters<typeof span.end>) => {
        spanEnded = true;
        originalEnd(...args);
      };
      return "done";
    });
    assert.ok(spanEnded);
  });

  it("records exception and re-throws on error", async () => {
    const tracer = createTracer("test-error-span");
    const error = new Error("test failure");
    await assert.rejects(
      async () => {
        await withSpan(tracer, "error-operation", (_span) => {
          throw error;
        });
      },
      (thrown: unknown) => thrown === error
    );
  });

  it("accepts span attributes", async () => {
    const tracer = createTracer("test-attrs");
    const result = await withSpan(tracer, "attributed-op", (_span) => "ok", {
      "http.method": "GET",
      "http.status_code": 200,
    });
    assert.equal(result, "ok");
  });
});

describe("withSpanSync", () => {
  it("executes the callback synchronously and returns the result", () => {
    const tracer = createTracer("test-sync-span");
    const result = withSpanSync(tracer, "sync-operation", (_span) => {
      return "sync-result";
    });
    assert.equal(result, "sync-result");
  });

  it("re-throws on error", () => {
    const tracer = createTracer("test-sync-error");
    assert.throws(
      () => {
        withSpanSync(tracer, "failing-sync", (_span) => {
          throw new Error("sync failure");
        });
      },
      { message: "sync failure" }
    );
  });
});

describe("getTraceContext", () => {
  it("returns an object with traceId and spanId fields", () => {
    const ctx = getTraceContext();
    assert.ok("traceId" in ctx);
    assert.ok("spanId" in ctx);
  });

  it("traceId and spanId are undefined or string when no active span", () => {
    const ctx = getTraceContext();
    // With no OTel SDK configured, the span is a NoopSpan — traceId/spanId may be strings
    assert.ok(ctx.traceId === undefined || typeof ctx.traceId === "string");
    assert.ok(ctx.spanId === undefined || typeof ctx.spanId === "string");
  });
});

describe("recordException", () => {
  it("does not throw when called with an Error", () => {
    const tracer = createTracer("test-record-exception");
    const span = tracer.startSpan("exception-span");
    assert.doesNotThrow(() => {
      recordException(span, new Error("recorded error"));
    });
    span.end();
  });

  it("does not throw when called with a non-Error value", () => {
    const tracer = createTracer("test-record-exception-non-error");
    const span = tracer.startSpan("exception-span-2");
    assert.doesNotThrow(() => {
      recordException(span, "string error");
    });
    span.end();
  });
});

describe("setSpanAttributes", () => {
  it("does not throw when setting attributes on a span", () => {
    const tracer = createTracer("test-set-attrs");
    const span = tracer.startSpan("attrs-span");
    assert.doesNotThrow(() => {
      setSpanAttributes(span, { "user.id": "123", "feature.name": "checkout" });
    });
    span.end();
  });
});
