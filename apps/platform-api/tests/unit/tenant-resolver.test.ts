import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSlugFromHost, isGlobalHost } from "../../src/server/tenant-resolver.ts";

describe("extractSlugFromHost — production apex (aldous.info)", () => {
  const apex = "aldous.info";

  it("returns null for the apex itself (global host)", () => {
    assert.equal(extractSlugFromHost("aldous.info", apex), null);
  });

  it("returns the slug for a valid tenant subdomain", () => {
    assert.equal(extractSlugFromHost("tenant1.aldous.info", apex), "tenant1");
    assert.equal(extractSlugFromHost("acme-corp.aldous.info", apex), "acme-corp");
  });

  it("returns null for reserved slugs", () => {
    assert.equal(extractSlugFromHost("staging.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("admin.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("api.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("kc.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("pgadmin.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("platform.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("aldous.aldous.info", apex), null);
  });

  it("returns null for unrelated hosts", () => {
    assert.equal(extractSlugFromHost("evil.com", apex), null);
    assert.equal(extractSlugFromHost("aldous.info.evil.com", apex), null);
  });

  it("returns null for empty string", () => {
    assert.equal(extractSlugFromHost("", apex), null);
  });
});

describe("extractSlugFromHost — staging apex (staging.aldous.info)", () => {
  const apex = "staging.aldous.info";

  it("returns null for the staging apex itself (global staging host)", () => {
    assert.equal(extractSlugFromHost("staging.aldous.info", apex), null);
  });

  it("returns the slug for a valid tenant staging subdomain", () => {
    assert.equal(extractSlugFromHost("tenant1.staging.aldous.info", apex), "tenant1");
  });

  it("returns null for production tenant subdomains when apex is staging", () => {
    assert.equal(extractSlugFromHost("tenant1.aldous.info", apex), null);
  });

  it("returns null for reserved slugs under staging apex", () => {
    assert.equal(extractSlugFromHost("admin.staging.aldous.info", apex), null);
    assert.equal(extractSlugFromHost("api.staging.aldous.info", apex), null);
  });
});

describe("isGlobalHost", () => {
  it("returns true for the production apex", () => {
    assert.ok(isGlobalHost("aldous.info", "aldous.info"));
  });

  it("returns true for the staging apex", () => {
    assert.ok(isGlobalHost("staging.aldous.info", "staging.aldous.info"));
  });

  it("returns true when host has a port", () => {
    assert.ok(isGlobalHost("aldous.info:3001", "aldous.info"));
  });

  it("returns false for tenant subdomains under production apex", () => {
    assert.ok(!isGlobalHost("tenant1.aldous.info", "aldous.info"));
  });

  it("returns false for tenant subdomains under staging apex", () => {
    assert.ok(!isGlobalHost("tenant1.staging.aldous.info", "staging.aldous.info"));
  });

  it("returns false for production subdomain when apex is staging", () => {
    assert.ok(!isGlobalHost("tenant1.aldous.info", "staging.aldous.info"));
  });

  it("returns false for unrelated hosts", () => {
    assert.ok(!isGlobalHost("evil.com", "aldous.info"));
  });
});
