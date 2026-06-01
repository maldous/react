import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "../../src/server/token-crypto.ts";

describe("token-crypto", () => {
  const KEY = "a".repeat(64); // 32 bytes hex

  before(() => {
    process.env["TENANT_SECRET_ENCRYPTION_KEY"] = KEY;
  });

  after(() => {
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  });

  it("encrypts and decrypts an access token roundtrip", () => {
    const token = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
    const encrypted = encryptToken(token);
    assert.notEqual(encrypted, token, "encrypted must differ from plaintext");
    assert.ok(encrypted.startsWith("enc:"), "must have enc: prefix");
    assert.equal(decryptToken(encrypted), token);
  });

  it("different calls produce different ciphertexts (random IV)", () => {
    const token = "same-token";
    assert.notEqual(encryptToken(token), encryptToken(token), "IVs must differ");
  });

  it("stores unencrypted with unenc: prefix when key absent", () => {
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    const token = "plain-token";
    const enc = encryptToken(token);
    assert.ok(enc.startsWith("unenc:"));
    assert.equal(decryptToken(enc), token);
    process.env["TENANT_SECRET_ENCRYPTION_KEY"] = KEY;
  });

  it("decryptToken throws on malformed ciphertext", () => {
    assert.throws(() => decryptToken("enc:bad"), /malformed/);
  });
});
