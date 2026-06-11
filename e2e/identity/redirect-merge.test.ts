import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeClientRedirects, type KeycloakClientRep } from "./redirect-merge.ts";

// Regression coverage for the broker-login global-setup merge (ADR-ACT-0157):
// the PUT-back must preserve existing redirectUris and every other client field,
// and reruns must be idempotent.

const WANT = ["http://localhost:5180/*", "http://localhost:5180/auth/callback"];

function baseClient(): KeycloakClientRep {
  return {
    id: "uuid-123",
    clientId: "platform-api",
    enabled: true,
    redirectUris: ["http://localhost:5173/*", "http://dev.localhost/auth/callback"],
    webOrigins: ["+"],
    attributes: { "post.logout.redirect.uris": "+" },
    protocolMappers: [{ name: "realm-roles" }],
  };
}

describe("mergeClientRedirects", () => {
  it("adds the new redirect URIs while preserving the existing ones", () => {
    const { merged, changed } = mergeClientRedirects(baseClient(), WANT);
    assert.equal(changed, true);
    assert.ok(merged.redirectUris?.some((u) => u === "http://localhost:5173/*"));
    assert.ok(merged.redirectUris?.some((u) => u === "http://dev.localhost/auth/callback"));
    for (const u of WANT) assert.ok(merged.redirectUris?.includes(u), `missing ${u}`);
  });

  it("preserves all other client fields verbatim", () => {
    const before = baseClient();
    const { merged } = mergeClientRedirects(before, WANT);
    assert.equal(merged.id, "uuid-123");
    assert.equal(merged.clientId, "platform-api");
    assert.equal(merged.enabled, true);
    assert.deepEqual(merged.attributes, { "post.logout.redirect.uris": "+" });
    assert.deepEqual(merged.protocolMappers, [{ name: "realm-roles" }]);
  });

  it("is idempotent: a rerun adds nothing and reports no change", () => {
    const first = mergeClientRedirects(baseClient(), WANT);
    const second = mergeClientRedirects(first.merged, WANT);
    assert.equal(second.changed, false);
    assert.deepEqual(second.merged.redirectUris, first.merged.redirectUris);
  });

  it("does not duplicate an already-present redirect URI", () => {
    const client = baseClient();
    client.redirectUris = [...(client.redirectUris ?? []), ...WANT];
    const { merged, changed } = mergeClientRedirects(client, WANT);
    assert.equal(changed, false);
    const count = merged.redirectUris!.filter((u) => u === WANT[0]).length;
    assert.equal(count, 1);
  });

  it("leaves webOrigins untouched when '+' (wildcard) is present", () => {
    const { merged } = mergeClientRedirects(baseClient(), WANT, ["http://localhost:5180"]);
    assert.deepEqual(merged.webOrigins, ["+"]);
  });

  it("merges an explicit web origin when no wildcard is configured", () => {
    const client = baseClient();
    client.webOrigins = ["http://localhost:5173"];
    const { merged, changed } = mergeClientRedirects(client, WANT, ["http://localhost:5180"]);
    assert.equal(changed, true);
    assert.ok(merged.webOrigins?.includes("http://localhost:5173"));
    assert.ok(merged.webOrigins?.includes("http://localhost:5180"));
  });

  it("treats a missing redirectUris array as empty", () => {
    const { merged, changed } = mergeClientRedirects({ id: "x", clientId: "c" }, WANT);
    assert.equal(changed, true);
    assert.deepEqual(merged.redirectUris, WANT);
  });
});
