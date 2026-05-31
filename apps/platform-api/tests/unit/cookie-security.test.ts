import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { isSecureCookie } from "../../src/server/auth.ts";

// ---------------------------------------------------------------------------
// isSecureCookie — SESSION_COOKIE_SECURE env var controls the Secure flag.
//
// Local HTTP (Compose): SESSION_COOKIE_SECURE=false → no Secure flag.
// Cloudflare / HTTPS:   SESSION_COOKIE_SECURE=true  → Secure flag added.
// NODE_ENV=production does NOT imply Secure (Cloudflare Flexible SSL means
// the browser→Caddy leg is plain HTTP; browsers reject Secure cookies over HTTP).
// ---------------------------------------------------------------------------

describe("isSecureCookie", () => {
  let original: string | undefined;

  before(() => {
    original = process.env["SESSION_COOKIE_SECURE"];
  });

  after(() => {
    if (original === undefined) {
      delete process.env["SESSION_COOKIE_SECURE"];
    } else {
      process.env["SESSION_COOKIE_SECURE"] = original;
    }
  });

  it("returns false when SESSION_COOKIE_SECURE is unset", () => {
    delete process.env["SESSION_COOKIE_SECURE"];
    assert.equal(isSecureCookie(), false);
  });

  it("returns false when SESSION_COOKIE_SECURE=false", () => {
    process.env["SESSION_COOKIE_SECURE"] = "false";
    assert.equal(isSecureCookie(), false);
  });

  it("returns true when SESSION_COOKIE_SECURE=true", () => {
    process.env["SESSION_COOKIE_SECURE"] = "true";
    assert.equal(isSecureCookie(), true);
  });

  it("returns false when NODE_ENV=production but SESSION_COOKIE_SECURE is not set", () => {
    delete process.env["SESSION_COOKIE_SECURE"];
    const prev = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      assert.equal(isSecureCookie(), false, "NODE_ENV=production must not auto-enable Secure");
    } finally {
      process.env["NODE_ENV"] = prev;
    }
  });
});
