import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createContext,
  createRequestContext,
  withOperation,
  withFeature,
  withActor,
  withTenant,
  withTrace,
  safeClientContext,
} from "../src/index.ts";

describe("createContext", () => {
  it("returns a copy of the provided RuntimeContext", () => {
    const ctx = createContext({ requestId: "req-1", traceId: "trace-1" });
    assert.equal(ctx.requestId, "req-1");
    assert.equal(ctx.traceId, "trace-1");
  });

  it("includes all provided optional fields", () => {
    const ctx = createContext({
      requestId: "req-2",
      actorId: "user-1",
      tenantId: "tenant-1",
      organisationId: "org-1",
      correlationId: "corr-1",
      featureName: "feature-a",
      operationName: "op-a",
    });
    assert.equal(ctx.actorId, "user-1");
    assert.equal(ctx.tenantId, "tenant-1");
    assert.equal(ctx.organisationId, "org-1");
    assert.equal(ctx.correlationId, "corr-1");
    assert.equal(ctx.featureName, "feature-a");
    assert.equal(ctx.operationName, "op-a");
  });

  it("does not mutate the input object", () => {
    const input = { requestId: "req-3" };
    const ctx = createContext(input);
    ctx.requestId = "modified";
    assert.equal(input.requestId, "req-3");
  });
});

describe("createRequestContext", () => {
  it("creates a context with only requestId", () => {
    const ctx = createRequestContext("req-4");
    assert.equal(ctx.requestId, "req-4");
    assert.equal(ctx.traceId, undefined);
    assert.equal(ctx.actorId, undefined);
  });

  it("merges overrides into the context", () => {
    const ctx = createRequestContext("req-5", { traceId: "t-5", actorId: "actor-5" });
    assert.equal(ctx.requestId, "req-5");
    assert.equal(ctx.traceId, "t-5");
    assert.equal(ctx.actorId, "actor-5");
  });

  it("requestId cannot be overridden via overrides", () => {
    const ctx = createRequestContext("req-6", {});
    assert.equal(ctx.requestId, "req-6");
  });
});

describe("withOperation", () => {
  it("adds operationName to the context", () => {
    const ctx = createRequestContext("req-7");
    const next = withOperation(ctx, "CreateUser");
    assert.equal(next.operationName, "CreateUser");
  });

  it("does not mutate the original context", () => {
    const ctx = createRequestContext("req-8");
    withOperation(ctx, "DeleteUser");
    assert.equal(ctx.operationName, undefined);
  });

  it("preserves existing fields", () => {
    const ctx = createRequestContext("req-9", { traceId: "t-9" });
    const next = withOperation(ctx, "GetUser");
    assert.equal(next.requestId, "req-9");
    assert.equal(next.traceId, "t-9");
  });
});

describe("withFeature", () => {
  it("adds featureName to the context", () => {
    const ctx = createRequestContext("req-10");
    const next = withFeature(ctx, "billing");
    assert.equal(next.featureName, "billing");
  });

  it("does not mutate the original context", () => {
    const ctx = createRequestContext("req-11");
    withFeature(ctx, "checkout");
    assert.equal(ctx.featureName, undefined);
  });
});

describe("withActor", () => {
  it("adds actorId to the context", () => {
    const ctx = createRequestContext("req-12");
    const next = withActor(ctx, "user-abc");
    assert.equal(next.actorId, "user-abc");
  });

  it("does not mutate the original context", () => {
    const ctx = createRequestContext("req-13");
    withActor(ctx, "user-xyz");
    assert.equal(ctx.actorId, undefined);
  });
});

describe("withTenant", () => {
  it("adds tenantId to the context", () => {
    const ctx = createRequestContext("req-14");
    const next = withTenant(ctx, "tenant-42");
    assert.equal(next.tenantId, "tenant-42");
  });

  it("adds organisationId when provided", () => {
    const ctx = createRequestContext("req-15");
    const next = withTenant(ctx, "tenant-43", "org-1");
    assert.equal(next.tenantId, "tenant-43");
    assert.equal(next.organisationId, "org-1");
  });
});

describe("withTrace", () => {
  it("adds traceId to the context", () => {
    const ctx = createRequestContext("req-16");
    const next = withTrace(ctx, "trace-abc");
    assert.equal(next.traceId, "trace-abc");
    assert.equal(next.spanId, undefined);
  });

  it("adds both traceId and spanId when both are provided", () => {
    const ctx = createRequestContext("req-17");
    const next = withTrace(ctx, "trace-def", "span-def");
    assert.equal(next.traceId, "trace-def");
    assert.equal(next.spanId, "span-def");
  });

  it("does not mutate the original context", () => {
    const ctx = createRequestContext("req-18");
    withTrace(ctx, "trace-xyz");
    assert.equal(ctx.traceId, undefined);
  });
});

describe("safeClientContext", () => {
  it("returns only requestId", () => {
    const ctx = createRequestContext("req-19", {
      traceId: "trace-safe",
      actorId: "actor-safe",
      tenantId: "tenant-safe",
    });
    const safe = safeClientContext(ctx);
    assert.equal(safe.requestId, "req-19");
    assert.deepEqual(Object.keys(safe), ["requestId"]);
  });

  it("does not include traceId or other sensitive fields", () => {
    const ctx = createRequestContext("req-20", { traceId: "t-sensitive" });
    const safe = safeClientContext(ctx);
    assert.ok(!("traceId" in safe));
    assert.ok(!("actorId" in safe));
  });
});
