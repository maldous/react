import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SecurityError, createNoopAuthPort, createNoopRateLimitPort } from "../src/index.ts";

describe("createNoopAuthPort", () => {
  it("returns valid=false for any token", async () => {
    const port = createNoopAuthPort();
    const result = await port.validateToken("any-token");
    assert.strictEqual(result.valid, false);
  });
});

describe("createNoopRateLimitPort", () => {
  it("always allows", async () => {
    const port = createNoopRateLimitPort();
    const result = await port.check("any-key");
    assert.strictEqual(result.allowed, true);
    assert.ok(result.remaining > 0);
  });
  it("reset resolves without error", async () => {
    const port = createNoopRateLimitPort();
    await assert.doesNotReject(() => port.reset("any-key"));
  });
});

describe("SecurityError", () => {
  it("is an Error with correct name", () => {
    const err = new SecurityError("msg");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "SecurityError");
  });
  it("carries an optional code", () => {
    const err = new SecurityError("msg", "TOKEN_EXPIRED");
    assert.strictEqual(err.code, "TOKEN_EXPIRED");
  });
});
