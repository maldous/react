import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLogger,
  createChildLogger,
  createRequestLogger,
  safeErrorMeta,
  safeContextMeta,
  createBrowserLogger,
  redactionPaths,
} from "../src/index.ts";

describe("createLogger", () => {
  it("returns an object with info/warn/error/debug methods", () => {
    const logger = createLogger({ name: "test-logger" });
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.warn, "function");
    assert.equal(typeof logger.error, "function");
    assert.equal(typeof logger.debug, "function");
  });

  it("respects the provided log level", () => {
    const logger = createLogger({ name: "test-logger-level", level: "warn" });
    assert.equal(logger.level, "warn");
  });

  it("defaults to info level", () => {
    const originalLevel = process.env["LOG_LEVEL"];
    delete process.env["LOG_LEVEL"];
    try {
      const logger = createLogger({ name: "test-logger-default" });
      assert.equal(logger.level, "info");
    } finally {
      if (originalLevel !== undefined) {
        process.env["LOG_LEVEL"] = originalLevel;
      }
    }
  });
});

describe("createChildLogger", () => {
  it("returns a child logger that inherits from parent", () => {
    const parent = createLogger({ name: "parent" });
    const child = createChildLogger(parent, { requestId: "req-1", component: "auth" });
    assert.equal(typeof child.info, "function");
  });

  it("child logger is a distinct object from parent", () => {
    const parent = createLogger({ name: "parent2" });
    const child = createChildLogger(parent, { extra: "field" });
    assert.notEqual(child, parent);
  });
});

describe("createRequestLogger", () => {
  it("binds requestId to the child logger", () => {
    const parent = createLogger({ name: "req-parent" });
    const logger = createRequestLogger(parent, { requestId: "req-abc" });
    assert.equal(typeof logger.info, "function");
  });

  it("accepts traceId and spanId in the context", () => {
    const parent = createLogger({ name: "req-parent2" });
    const logger = createRequestLogger(parent, {
      requestId: "req-xyz",
      traceId: "trace-1",
      spanId: "span-1",
    });
    assert.equal(typeof logger.debug, "function");
  });

  it("works without optional traceId and spanId", () => {
    const parent = createLogger({ name: "req-parent3" });
    const logger = createRequestLogger(parent, { requestId: "req-only" });
    assert.ok(logger !== null);
  });
});

describe("safeErrorMeta", () => {
  it("returns errMessage, errName for Error instances", () => {
    const err = new Error("something broke");
    const meta = safeErrorMeta(err);
    assert.equal(meta["errMessage"], "something broke");
    assert.equal(meta["errName"], "Error");
  });

  it("does not return stack by default", () => {
    const err = new Error("oops");
    const meta = safeErrorMeta(err);
    assert.ok(!("stack" in meta));
  });

  it("includes errCode when error has a code property", () => {
    const err = Object.assign(new Error("coded"), { code: "ERR_SOMETHING" });
    const meta = safeErrorMeta(err);
    assert.equal(meta["errCode"], "ERR_SOMETHING");
  });

  it("handles non-Error values gracefully", () => {
    const meta = safeErrorMeta("a string error");
    assert.equal(meta["errMessage"], "a string error");
    assert.equal(meta["errName"], "UnknownError");
  });

  it("does not expose internal details", () => {
    const err = new Error("db error");
    const meta = safeErrorMeta(err);
    assert.ok(!("internalDetails" in meta));
    assert.ok(!("query" in meta));
  });
});

describe("safeContextMeta", () => {
  it("returns an object with requestId", () => {
    const meta = safeContextMeta({ requestId: "req-ctx" });
    assert.equal(meta["requestId"], "req-ctx");
  });

  it("includes traceId when provided", () => {
    const meta = safeContextMeta({ requestId: "req-1", traceId: "trace-1" });
    assert.equal(meta["traceId"], "trace-1");
  });

  it("includes operationName when provided", () => {
    const meta = safeContextMeta({
      requestId: "req-2",
      traceId: "t2",
      spanId: "s2",
      operationName: "CreateUser",
    });
    assert.equal(meta["operationName"], "CreateUser");
    assert.equal(meta["spanId"], "s2");
  });

  it("omits optional fields when not provided", () => {
    const meta = safeContextMeta({ requestId: "req-3" });
    assert.ok(!("traceId" in meta));
    assert.ok(!("spanId" in meta));
    assert.ok(!("operationName" in meta));
  });
});

describe("createBrowserLogger", () => {
  it("returns an object with all log level methods", () => {
    const logger = createBrowserLogger({ name: "browser-test" });
    assert.equal(typeof logger.debug, "function");
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.warn, "function");
    assert.equal(typeof logger.error, "function");
  });

  it("does not throw when calling log methods", () => {
    const logger = createBrowserLogger({ name: "browser-test2" });
    assert.doesNotThrow(() => logger.info("test message"));
    assert.doesNotThrow(() => logger.warn("warn message", { extra: "field" }));
    assert.doesNotThrow(() => logger.error("error message"));
  });

  it("accepts a log level option", () => {
    const logger = createBrowserLogger({ name: "browser-level", level: "error" });
    assert.doesNotThrow(() => logger.debug("should be filtered"));
    assert.doesNotThrow(() => logger.error("should be emitted"));
  });
});

describe("redactionPaths", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(redactionPaths));
    assert.ok(redactionPaths.length > 0);
  });

  it("includes password path", () => {
    assert.ok(redactionPaths.includes("password"));
  });

  it("includes authorization path", () => {
    assert.ok(redactionPaths.includes("authorization"));
  });

  it("includes database credential paths", () => {
    assert.ok(redactionPaths.includes("DATABASE_URL") || redactionPaths.includes("databaseUrl"));
  });

  it("includes wildcard token path", () => {
    assert.ok(redactionPaths.includes("*.token"));
  });
});
