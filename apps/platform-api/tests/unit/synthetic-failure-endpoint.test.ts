import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { routes } from "../../src/server/routes.ts";

// ADR-ACT-0285 Phase 5 / 5.5 — security guard for the gated synthetic-failure
// endpoint. It MUST be invisible (404) unless explicitly enabled, and in
// production MUST additionally require E2E_ALLOW_PROD_SYNTHETIC_FAILURE — so a
// synthetic 500 can never be triggered in prod by accident.

const triggerRoute = routes.find(
  (r) => r.path === "/internal/e2e/trigger-failure" && r.method === "POST"
);

function fakeRes() {
  const calls: { status: number; body: unknown }[] = [];
  return {
    res: { json: (status: number, body: unknown) => calls.push({ status, body }) },
    calls,
  };
}

describe("POST /internal/e2e/trigger-failure gating", () => {
  const KEYS = [
    "E2E_FAILURE_ENDPOINT_ENABLED",
    "PLATFORM_ENV",
    "E2E_ALLOW_PROD_SYNTHETIC_FAILURE",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("registers the route", () => {
    assert.ok(triggerRoute, "trigger-failure route must exist");
  });

  it("returns 404 when not enabled (default)", async () => {
    const { res, calls } = fakeRes();
    await triggerRoute!.handler({} as never, res as never);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, 404);
  });

  it("throws a typed error (→500) when enabled in a non-prod env", async () => {
    process.env["E2E_FAILURE_ENDPOINT_ENABLED"] = "true";
    const { res } = fakeRes();
    await assert.rejects(() => triggerRoute!.handler({} as never, res as never));
  });

  it("stays 404 in production WITHOUT the explicit prod approval flag", async () => {
    process.env["E2E_FAILURE_ENDPOINT_ENABLED"] = "true";
    process.env["PLATFORM_ENV"] = "production";
    const { res, calls } = fakeRes();
    await triggerRoute!.handler({} as never, res as never);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, 404);
  });

  it("triggers in production only when both flags are set", async () => {
    process.env["E2E_FAILURE_ENDPOINT_ENABLED"] = "true";
    process.env["PLATFORM_ENV"] = "production";
    process.env["E2E_ALLOW_PROD_SYNTHETIC_FAILURE"] = "true";
    const { res } = fakeRes();
    await assert.rejects(() => triggerRoute!.handler({} as never, res as never));
  });
});
