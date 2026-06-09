/**
 * Unit tests for the platform-api Sentry wiring (ADR-ACT-0197).
 * Guarantees exception monitoring is OPT-IN: disabled unless SENTRY_ENABLED=true.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { createSentryAdapter } from "../../src/server/observability.ts";

const ORIGINAL_ENABLED = process.env["SENTRY_ENABLED"];
const ORIGINAL_DSN = process.env["SENTRY_DSN"];

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env["SENTRY_ENABLED"];
  else process.env["SENTRY_ENABLED"] = ORIGINAL_ENABLED;
  if (ORIGINAL_DSN === undefined) delete process.env["SENTRY_DSN"];
  else process.env["SENTRY_DSN"] = ORIGINAL_DSN;
});

describe("createSentryAdapter (platform-api wiring)", () => {
  it("is disabled by default — captureError is a no-op when SENTRY_ENABLED is unset", () => {
    delete process.env["SENTRY_ENABLED"];
    process.env["SENTRY_DSN"] = "https://example@sentry.invalid/1";
    const adapter = createSentryAdapter();
    assert.strictEqual(adapter.captureError(new Error("boom")), undefined);
  });

  it("stays disabled when SENTRY_ENABLED=true but no DSN is configured", () => {
    process.env["SENTRY_ENABLED"] = "true";
    delete process.env["SENTRY_DSN"];
    const adapter = createSentryAdapter();
    assert.strictEqual(adapter.captureError(new Error("boom")), undefined);
  });

  it("flush resolves true when disabled (safe to await in startup error path)", async () => {
    delete process.env["SENTRY_ENABLED"];
    const adapter = createSentryAdapter();
    assert.strictEqual(await adapter.flush(10), true);
  });
});
