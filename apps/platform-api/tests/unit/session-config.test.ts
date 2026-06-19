import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSessionConfig } from "../../src/config/session-config.ts";

test("session config defaults preserve prior behaviour (hermetic)", () => {
  const cfg = loadSessionConfig({ source: {} });
  assert.equal(cfg.cookieDomain, undefined); // omitted Domain when unset
  assert.equal(cfg.cookieSecure, ""); // compared === "true" (compose sets "false")
  assert.equal(cfg.ttlSeconds, 1800);
  assert.equal(cfg.localFixtureSession, undefined);
});

test("cookieSecure stays a string; only === 'true' enables Secure", () => {
  assert.equal(
    loadSessionConfig({ source: { SESSION_COOKIE_SECURE: "false" } }).cookieSecure,
    "false"
  );
  assert.equal(
    loadSessionConfig({ source: { SESSION_COOKIE_SECURE: "true" } }).cookieSecure,
    "true"
  );
});

test("ttlSeconds is a typed number", () => {
  assert.equal(loadSessionConfig({ source: { SESSION_TTL_SECONDS: "3600" } }).ttlSeconds, 3600);
});
