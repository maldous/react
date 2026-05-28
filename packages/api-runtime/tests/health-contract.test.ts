import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHealthResponse,
  createReadinessResponse,
  createVersionResponse,
} from "../src/index.ts";

describe("createHealthResponse", () => {
  it("returns { status: 'ok' }", () => {
    const response = createHealthResponse();
    assert.deepEqual(response, { status: "ok" });
  });

  it("always returns status ok", () => {
    const response = createHealthResponse();
    assert.equal(response.status, "ok");
  });
});

describe("createReadinessResponse", () => {
  it("returns ready when all dependencies are ok", () => {
    const response = createReadinessResponse({ db: "ok", redis: "ok" });
    assert.equal(response.status, "ready");
    assert.deepEqual(response.dependencies, { db: "ok", redis: "ok" });
  });

  it("returns not-ready when a dependency is failed", () => {
    const response = createReadinessResponse({ db: "ok", redis: "failed" });
    assert.equal(response.status, "not-ready");
  });

  it("returns not-ready when a dependency is unknown", () => {
    const response = createReadinessResponse({ db: "unknown" });
    assert.equal(response.status, "not-ready");
  });

  it("returns ready with empty dependencies map", () => {
    const response = createReadinessResponse({});
    assert.equal(response.status, "ready");
  });

  it("includes the full dependencies map in the response", () => {
    const deps = { db: "ok" as const, cache: "failed" as const, search: "unknown" as const };
    const response = createReadinessResponse(deps);
    assert.deepEqual(response.dependencies, deps);
  });
});

describe("createVersionResponse", () => {
  it("includes all fields when fully specified", () => {
    const response = createVersionResponse({
      version: "1.2.3",
      gitSha: "abc123",
      buildTime: "2026-05-01T12:00:00Z",
      environment: "production",
    });
    assert.equal(response.version, "1.2.3");
    assert.equal(response.gitSha, "abc123");
    assert.equal(response.buildTime, "2026-05-01T12:00:00Z");
    assert.equal(response.environment, "production");
  });

  it("defaults gitSha to 'unknown' when not provided", () => {
    const response = createVersionResponse({ version: "1.0.0", environment: "staging" });
    assert.equal(response.gitSha, "unknown");
  });

  it("defaults buildTime to 'unknown' when not provided", () => {
    const response = createVersionResponse({ version: "1.0.0", environment: "staging" });
    assert.equal(response.buildTime, "unknown");
  });

  it("preserves the environment field", () => {
    const response = createVersionResponse({ version: "0.1.0", environment: "development" });
    assert.equal(response.environment, "development");
  });
});
