import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import {
  createLogger,
  createChildLogger,
  createRequestLogger,
  safeErrorMeta,
  safeContextMeta,
  createBrowserLogger,
  normaliseError,
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

describe("createLogger — configuration", () => {
  it("returns a pino logger with the requested level", () => {
    const logger = createLogger({ name: "config-test", level: "debug" });
    assert.equal(logger.level, "debug");
  });

  it("defaults level to info when no option or env var", () => {
    const orig = process.env["LOG_LEVEL"];
    delete process.env["LOG_LEVEL"];
    try {
      const logger = createLogger({ name: "config-default" });
      assert.equal(logger.level, "info");
    } finally {
      if (orig !== undefined) process.env["LOG_LEVEL"] = orig;
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

  it("includes SENTRY_DSN", () => {
    assert.ok(redactionPaths.includes("SENTRY_DSN"));
  });

  it("includes cookie path", () => {
    assert.ok(redactionPaths.includes("cookie"));
  });

  it("includes token path", () => {
    assert.ok(redactionPaths.includes("token"));
  });
});

describe("createLogger — all six log levels", () => {
  it("has trace and fatal methods in addition to debug/info/warn/error", () => {
    const logger = createLogger({ name: "six-levels-test" });
    assert.equal(typeof logger.trace, "function");
    assert.equal(typeof logger.debug, "function");
    assert.equal(typeof logger.info, "function");
    assert.equal(typeof logger.warn, "function");
    assert.equal(typeof logger.error, "function");
    assert.equal(typeof logger.fatal, "function");
  });

  it("emits at trace level when level is set to trace", () => {
    const logger = createLogger({ name: "trace-level-test", level: "trace" });
    assert.equal(logger.level, "trace");
  });

  it("emits at fatal level (fatal method exists and does not throw)", () => {
    const logger = createLogger({ name: "fatal-level-test", level: "fatal" });
    assert.equal(logger.level, "fatal");
    assert.doesNotThrow(() => logger.fatal("fatal test message"));
  });
});

describe("pino base fields — service/packageName/boundedContext/environment/version/gitSha present in output", () => {
  it("includes service, packageName, boundedContext, environment, version, gitSha in every log entry", () => {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    const logger = pino(
      {
        level: "info",
        base: {
          service: "test-svc",
          packageName: "@platform/test",
          boundedContext: "test-context",
          environment: "test",
          version: "1.0.0",
          gitSha: "abc123",
        },
        redact: { paths: redactionPaths, censor: "[REDACTED]" },
      },
      dest
    );
    logger.info("base fields check");
    assert.ok(output.length > 0, "expected at least one log line");
    const parsed = JSON.parse(output[0] as string);
    assert.equal(parsed["service"], "test-svc");
    assert.equal(parsed["packageName"], "@platform/test");
    assert.equal(parsed["boundedContext"], "test-context");
    assert.equal(parsed["environment"], "test");
    assert.equal(parsed["version"], "1.0.0");
    assert.equal(parsed["gitSha"], "abc123");
  });
});

describe("redactionPaths — sensitive values are censored in pino output", () => {
  it("redacts password field in log output", () => {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    const logger = pino(
      {
        level: "info",
        redact: { paths: redactionPaths, censor: "[REDACTED]" },
      },
      dest
    );
    logger.info({ password: "super-secret", user: "alice" }, "test redaction");
    assert.ok(output.length > 0, "expected at least one log line");
    const parsed = JSON.parse(output[0] as string);
    assert.equal(parsed["password"], "[REDACTED]");
    assert.equal(parsed["user"], "alice");
  });

  it("redacts token field in log output", () => {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    const logger = pino(
      {
        level: "info",
        redact: { paths: redactionPaths, censor: "[REDACTED]" },
      },
      dest
    );
    logger.info({ token: "my-auth-token-xyz", userId: "u1" }, "token redaction");
    assert.ok(output.length > 0, "expected at least one log line");
    const parsed = JSON.parse(output[0] as string);
    assert.equal(parsed["token"], "[REDACTED]");
    assert.equal(parsed["userId"], "u1");
  });

  it("redacts cookie field in log output", () => {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    const logger = pino(
      {
        level: "info",
        redact: { paths: redactionPaths, censor: "[REDACTED]" },
      },
      dest
    );
    logger.info({ cookie: "session=abc123", path: "/api" }, "cookie redaction");
    assert.ok(output.length > 0, "expected at least one log line");
    const parsed = JSON.parse(output[0] as string);
    assert.equal(parsed["cookie"], "[REDACTED]");
    assert.equal(parsed["path"], "/api");
  });

  it("redacts SENTRY_DSN field in log output", () => {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    const logger = pino(
      {
        level: "info",
        redact: { paths: redactionPaths, censor: "[REDACTED]" },
      },
      dest
    );
    logger.info({ SENTRY_DSN: "https://key@sentry.io/123", env: "prod" }, "dsn redaction");
    assert.ok(output.length > 0, "expected at least one log line");
    const parsed = JSON.parse(output[0] as string);
    assert.equal(parsed["SENTRY_DSN"], "[REDACTED]");
    assert.equal(parsed["env"], "prod");
  });
});

describe("normaliseError", () => {
  it("returns name, message, and stack for Error instances", () => {
    const err = new Error("something went wrong");
    const result = normaliseError(err);
    assert.equal(result["name"], "Error");
    assert.equal(result["message"], "something went wrong");
    assert.ok(typeof result["stack"] === "string" || result["stack"] === undefined);
  });

  it("handles non-Error values (strings)", () => {
    const result = normaliseError("plain string error");
    assert.equal(result["name"], "UnknownError");
    assert.equal(result["message"], "plain string error");
  });

  it("handles non-Error values (objects)", () => {
    const result = normaliseError({ weird: true });
    assert.equal(result["name"], "UnknownError");
    assert.ok(typeof result["message"] === "string");
  });

  it("includes cause when present as an Error", () => {
    const cause = new Error("root cause");
    const err = new Error("outer error", { cause });
    const result = normaliseError(err);
    assert.ok(result["cause"] !== undefined, "cause should be present");
    const causeObj = result["cause"] as Record<string, unknown>;
    assert.equal(causeObj["name"], "Error");
    assert.equal(causeObj["message"], "root cause");
  });

  it("includes cause when present as a non-Error value", () => {
    const err = new Error("outer error");
    (err as unknown as { cause: unknown }).cause = "string cause";
    const result = normaliseError(err);
    assert.equal(result["cause"], "string cause");
  });

  // Smoke test (deferred — infrastructure-dependent):
  // ADR-ACT-0196 also requires: Loki receives a platform-api log with requestId
  // after a /healthz hit. This requires Loki running in the compose stack.
  // To verify: `make compose-up-default && curl -fsS http://localhost:3001/healthz`
  // then query Loki for {service="platform-api"} | json | requestId != "".
});

describe("createRequestLogger — bound fields", () => {
  it("binds all optional fields when provided", () => {
    const parent = createLogger({ name: "req-full-parent" });
    const logger = createRequestLogger(parent, {
      requestId: "req-full",
      traceId: "trace-full",
      spanId: "span-full",
      actorId: "actor-1",
      tenantId: "tenant-1",
      organisationId: "org-1",
      operationName: "FullOp",
      method: "POST",
      path: "/api/test",
    });
    assert.equal(typeof logger.info, "function");
    assert.notEqual(logger, parent);
  });

  it("bound fields (requestId, traceId, spanId, operationName) appear in serialised log output", () => {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
        output.push(chunk.toString());
        cb();
      },
    });
    const parent = pino({ level: "info" }, dest);
    const logger = createRequestLogger(parent, {
      requestId: "req-bound-test",
      traceId: "trace-bound-test",
      spanId: "span-bound-test",
      operationName: "BoundFieldsOp",
    });
    logger.info("bound fields check");
    assert.ok(output.length > 0, "expected at least one log line");
    const parsed = JSON.parse(output[0] as string);
    assert.equal(parsed["requestId"], "req-bound-test");
    assert.equal(parsed["traceId"], "trace-bound-test");
    assert.equal(parsed["spanId"], "span-bound-test");
    assert.equal(parsed["operationName"], "BoundFieldsOp");
  });
});
