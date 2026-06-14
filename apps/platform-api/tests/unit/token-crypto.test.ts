import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  encryptToken,
  decryptToken,
  assertEncryptionKeyConfigured,
} from "../../src/server/token-crypto.ts";

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

describe("assertEncryptionKeyConfigured", () => {
  const KEY = "a".repeat(64);
  let origKey: string | undefined;
  let origPlatformEnv: string | undefined;
  let origNodeEnv: string | undefined;

  before(() => {
    origKey = process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    origPlatformEnv = process.env["PLATFORM_ENV"];
    origNodeEnv = process.env["NODE_ENV"];
  });

  after(() => {
    if (origKey === undefined) {
      delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    } else {
      process.env["TENANT_SECRET_ENCRYPTION_KEY"] = origKey;
    }
    if (origPlatformEnv === undefined) {
      delete process.env["PLATFORM_ENV"];
    } else {
      process.env["PLATFORM_ENV"] = origPlatformEnv;
    }
    if (origNodeEnv === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = origNodeEnv;
    }
  });

  it("throws on staging without key", () => {
    process.env["PLATFORM_ENV"] = "staging";
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    try {
      assert.throws(() => assertEncryptionKeyConfigured(), /TENANT_SECRET_ENCRYPTION_KEY/);
    } finally {
      if (origKey !== undefined) process.env["TENANT_SECRET_ENCRYPTION_KEY"] = origKey;
    }
  });

  it("throws on production without key", () => {
    process.env["PLATFORM_ENV"] = "production";
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    try {
      assert.throws(() => assertEncryptionKeyConfigured(), /TENANT_SECRET_ENCRYPTION_KEY/);
    } finally {
      if (origKey !== undefined) process.env["TENANT_SECRET_ENCRYPTION_KEY"] = origKey;
    }
  });

  it("does not throw on development without key", () => {
    process.env["PLATFORM_ENV"] = "development";
    process.env["NODE_ENV"] = "development";
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    try {
      assert.doesNotThrow(() => assertEncryptionKeyConfigured());
    } finally {
      if (origKey !== undefined) process.env["TENANT_SECRET_ENCRYPTION_KEY"] = origKey;
    }
  });

  it("does not throw on test without key", () => {
    process.env["PLATFORM_ENV"] = "test";
    process.env["NODE_ENV"] = "test";
    delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    try {
      assert.doesNotThrow(() => assertEncryptionKeyConfigured());
    } finally {
      if (origKey !== undefined) process.env["TENANT_SECRET_ENCRYPTION_KEY"] = origKey;
    }
  });

  it("does not throw on staging with a valid key", () => {
    process.env["PLATFORM_ENV"] = "staging";
    process.env["TENANT_SECRET_ENCRYPTION_KEY"] = KEY;
    assert.doesNotThrow(() => assertEncryptionKeyConfigured());
  });

  it("throws on staging with an invalid-length key", () => {
    process.env["PLATFORM_ENV"] = "staging";
    process.env["TENANT_SECRET_ENCRYPTION_KEY"] = "abc";
    try {
      assert.throws(() => assertEncryptionKeyConfigured(), /TENANT_SECRET_ENCRYPTION_KEY/);
    } finally {
      if (origKey !== undefined) process.env["TENANT_SECRET_ENCRYPTION_KEY"] = origKey;
    }
  });
});
