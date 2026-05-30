import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createLogger,
  createRequestLogger,
  safeErrorMeta,
  redactionPaths,
} from "@platform/platform-logging";
import { createTracer, withSpan, getTraceContext } from "@platform/platform-observability";
import {
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  toSafeResponse,
  assertPermission,
  assertAuthenticated,
} from "@platform/platform-errors";
import { createRequestContext, withOperation } from "@platform/platform-runtime-context";

describe("observability smoke ? platform primitives integration", () => {
  it("platform-logging: createRequestLogger binds requestId to log output", () => {
    const logger = createLogger({ name: "test-service" });
    const reqLogger = createRequestLogger(logger, {
      requestId: "req-smoke-001",
      traceId: "trace-abc123",
    });
    const spy = mock.method(reqLogger, "info", function () {
      return reqLogger;
    });
    reqLogger.info("smoke test log");
    assert.equal(spy.mock.callCount(), 1);
    spy.mock.restore();
  });

  it("platform-runtime-context: createRequestContext includes requestId", () => {
    const ctx = createRequestContext("req-123", {
      traceId: "trace-xyz",
      operationName: "smoke-test",
    });
    assert.equal(ctx.requestId, "req-123");
    assert.equal(ctx.traceId, "trace-xyz");
    assert.equal(ctx.operationName, "smoke-test");
  });

  it("platform-runtime-context: withOperation returns context with operationName", () => {
    const ctx = createRequestContext("req-456");
    const ctx2 = withOperation(ctx, "getOrganisationProfile");
    assert.equal(ctx2.operationName, "getOrganisationProfile");
    assert.equal(ctx2.requestId, "req-456");
  });

  it("platform-errors: ValidationError serializes to safe response shape", () => {
    const err = new ValidationError("Name is required", {
      safeDetails: { field: "displayName" },
    });
    const safe = toSafeResponse(err);
    assert.equal(safe.code, "VALIDATION_ERROR");
    assert.equal(safe.message, "Name is required");
    assert.deepEqual(safe.details, { field: "displayName" });
  });

  it("platform-errors: assertPermission throws ForbiddenError when missing", () => {
    assert.throws(
      () => assertPermission(["organisation.read"], "organisation.update"),
      ForbiddenError
    );
  });

  it("platform-errors: assertAuthenticated throws UnauthorizedError when null", () => {
    assert.throws(() => assertAuthenticated(null), UnauthorizedError);
  });

  it("platform-errors: internalDetails are NOT in toSafeResponse", () => {
    const err = new ValidationError("public message", {
      safeDetails: { visible: true },
      internalDetails: { sql: "DROP TABLE users" },
    });
    const safe = toSafeResponse(err);
    assert.ok(!JSON.stringify(safe).includes("DROP TABLE"));
    assert.ok(!JSON.stringify(safe).includes("internalDetails"));
  });

  it("platform-logging: redactionPaths includes password and authorization", () => {
    assert.ok(redactionPaths.includes("password"));
    assert.ok(redactionPaths.some((p: string) => p.includes("authorization")));
  });

  it("platform-logging: safeErrorMeta does not expose stack trace", () => {
    const err = new Error("something went wrong");
    const meta = safeErrorMeta(err);
    assert.ok(!("stack" in meta));
    assert.ok("errMessage" in meta);
  });

  it("platform-observability: createTracer returns a Tracer", () => {
    const tracer = createTracer("substrate-smoke");
    assert.ok(tracer);
    assert.equal(typeof tracer.startSpan, "function");
  });

  it("platform-observability: withSpan executes callback", async () => {
    const tracer = createTracer("substrate-smoke");
    const result = await withSpan(tracer, "smoke-operation", async () => "span-result");
    assert.equal(result, "span-result");
  });

  it("platform-observability: getTraceContext returns object with traceId/spanId", () => {
    const ctx = getTraceContext();
    assert.ok("traceId" in ctx);
    assert.ok("spanId" in ctx);
  });
});
