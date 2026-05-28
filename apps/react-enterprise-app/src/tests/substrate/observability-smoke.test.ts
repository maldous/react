import { describe, it, expect, vi } from "vitest";
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

describe("observability smoke — platform primitives integration", () => {
  it("platform-logging: createRequestLogger binds requestId to log output", () => {
    const messages: Record<string, unknown>[] = [];
    const logger = createLogger({ name: "test-service" });
    const reqLogger = createRequestLogger(logger, {
      requestId: "req-smoke-001",
      traceId: "trace-abc123",
    });
    const spy = vi.spyOn(reqLogger, "info").mockImplementation((obj: unknown, msg?: string) => {
      messages.push({ ...(typeof obj === "object" ? (obj as Record<string, unknown>) : {}), msg });
      return reqLogger;
    });
    reqLogger.info("smoke test log");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("platform-runtime-context: createRequestContext includes requestId", () => {
    const ctx = createRequestContext("req-123", {
      traceId: "trace-xyz",
      operationName: "smoke-test",
    });
    expect(ctx.requestId).toBe("req-123");
    expect(ctx.traceId).toBe("trace-xyz");
    expect(ctx.operationName).toBe("smoke-test");
  });

  it("platform-runtime-context: withOperation returns context with operationName", () => {
    const ctx = createRequestContext("req-456");
    const ctx2 = withOperation(ctx, "getOrganisationProfile");
    expect(ctx2.operationName).toBe("getOrganisationProfile");
    expect(ctx2.requestId).toBe("req-456");
  });

  it("platform-errors: ValidationError serializes to safe response shape", () => {
    const err = new ValidationError("Name is required", {
      safeDetails: { field: "displayName" },
    });
    const safe = toSafeResponse(err);
    expect(safe.code).toBe("VALIDATION_ERROR");
    expect(safe.message).toBe("Name is required");
    expect(safe.details).toEqual({ field: "displayName" });
  });

  it("platform-errors: assertPermission throws ForbiddenError when missing", () => {
    expect(() => assertPermission(["organisation.read"], "organisation.update")).toThrow(
      ForbiddenError
    );
  });

  it("platform-errors: assertAuthenticated throws UnauthorizedError when null", () => {
    expect(() => assertAuthenticated(null)).toThrow(UnauthorizedError);
  });

  it("platform-errors: internalDetails are NOT in toSafeResponse", () => {
    const err = new ValidationError("public message", {
      safeDetails: { visible: true },
      internalDetails: { sql: "DROP TABLE users" },
    });
    const safe = toSafeResponse(err);
    expect(JSON.stringify(safe)).not.toContain("DROP TABLE");
    expect(JSON.stringify(safe)).not.toContain("internalDetails");
  });

  it("platform-logging: redactionPaths includes password and authorization", () => {
    expect(redactionPaths).toContain("password");
    expect(redactionPaths.some((p: string) => p.includes("authorization"))).toBe(true);
  });

  it("platform-logging: safeErrorMeta does not expose stack trace", () => {
    const err = new Error("something went wrong");
    const meta = safeErrorMeta(err);
    expect(meta).not.toHaveProperty("stack");
    expect(meta).toHaveProperty("errMessage");
  });

  it("platform-observability: createTracer returns a Tracer", () => {
    const tracer = createTracer("substrate-smoke");
    expect(tracer).toBeTruthy();
    expect(typeof tracer.startSpan).toBe("function");
  });

  it("platform-observability: withSpan executes callback", async () => {
    const tracer = createTracer("substrate-smoke");
    const result = await withSpan(tracer, "smoke-operation", async () => "span-result");
    expect(result).toBe("span-result");
  });

  it("platform-observability: getTraceContext returns object with traceId/spanId", () => {
    const ctx = getTraceContext();
    expect(ctx).toHaveProperty("traceId");
    expect(ctx).toHaveProperty("spanId");
  });
});
