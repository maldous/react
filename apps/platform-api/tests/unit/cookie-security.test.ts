import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { isSecureCookie, buildClearCookieHeaders } from "../../src/server/auth.ts";

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

// ---------------------------------------------------------------------------
// buildClearCookieHeaders — clears both host-only and domain-scoped cookies.
//
// Background: previously buildClearCookieHeader() emitted only a host-only
// Max-Age=0 cookie, ignoring SESSION_COOKIE_DOMAIN. If a cookie was SET with
// Domain=aldous.info (as it now is), the old host-only clear did not remove it
// from the browser, leaving the user silently re-authed after logout.
//
// Fix: emit two headers — one host-only (clears legacy cookies), one with Domain
// (clears cookies set under the current SESSION_COOKIE_DOMAIN configuration).
// ---------------------------------------------------------------------------

describe("buildClearCookieHeaders — cookie domain regression (logout fix)", () => {
  let origDomain: string | undefined;
  let origSecure: string | undefined;

  before(() => {
    origDomain = process.env["SESSION_COOKIE_DOMAIN"];
    origSecure = process.env["SESSION_COOKIE_SECURE"];
  });

  after(() => {
    if (origDomain === undefined) delete process.env["SESSION_COOKIE_DOMAIN"];
    else process.env["SESSION_COOKIE_DOMAIN"] = origDomain;
    if (origSecure === undefined) delete process.env["SESSION_COOKIE_SECURE"];
    else process.env["SESSION_COOKIE_SECURE"] = origSecure;
  });

  it("returns one header (host-only) when SESSION_COOKIE_DOMAIN is unset", () => {
    delete process.env["SESSION_COOKIE_DOMAIN"];
    delete process.env["SESSION_COOKIE_SECURE"];
    const headers = buildClearCookieHeaders();
    assert.equal(headers.length, 1, "only one header when no domain configured");
    assert.ok(headers[0]!.includes("Max-Age=0"), "must set Max-Age=0");
    assert.ok(!headers[0]!.includes("Domain="), "must not include Domain when unset");
  });

  it("returns two headers when SESSION_COOKIE_DOMAIN is set — one host-only, one domain-scoped", () => {
    process.env["SESSION_COOKIE_DOMAIN"] = "aldous.info";
    delete process.env["SESSION_COOKIE_SECURE"];
    const headers = buildClearCookieHeaders();
    assert.equal(headers.length, 2, "two headers when SESSION_COOKIE_DOMAIN is set");

    // First header: host-only clear (no Domain attribute)
    const hostOnly = headers[0]!;
    assert.ok(hostOnly.includes("Max-Age=0"), "host-only header must clear with Max-Age=0");
    assert.ok(!hostOnly.includes("Domain="), "host-only header must not include Domain");

    // Second header: domain-scoped clear
    const domainScoped = headers[1]!;
    assert.ok(domainScoped.includes("Max-Age=0"), "domain header must clear with Max-Age=0");
    assert.ok(
      domainScoped.includes("Domain=aldous.info"),
      "domain header must include configured Domain"
    );
  });

  it("domain-scoped header includes Secure when SESSION_COOKIE_SECURE=true", () => {
    process.env["SESSION_COOKIE_DOMAIN"] = "staging.aldous.info";
    process.env["SESSION_COOKIE_SECURE"] = "true";
    const headers = buildClearCookieHeaders();
    assert.equal(headers.length, 2);
    for (const h of headers) {
      assert.ok(h.includes("Secure"), "both headers must include Secure when enabled");
    }
    assert.ok(
      headers[1]!.includes("Domain=staging.aldous.info"),
      "domain header must use configured domain"
    );
  });

  it("no Domain attribute on host-only header regardless of SESSION_COOKIE_DOMAIN", () => {
    process.env["SESSION_COOKIE_DOMAIN"] = "aldous.info";
    const headers = buildClearCookieHeaders();
    // The first header must NEVER have Domain — it is the host-only fallback
    assert.ok(!headers[0]!.includes("Domain="), "first header must always be host-only");
  });
});
