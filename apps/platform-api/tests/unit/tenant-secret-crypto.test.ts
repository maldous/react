import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decryptTenantSecret,
  encryptTenantSecret,
  loadTenantSecretCryptoProviderConfig,
  tenantSecretCryptoHealthCheck,
  tenantSecretCryptoRecoveryAction,
} from "../../src/adapters/tenant-secret-crypto.ts";

const KEY = "b".repeat(64);

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const oldKey = process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  const oldTimeout = process.env["TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS"];
  try {
    process.env["TENANT_SECRET_ENCRYPTION_KEY"] = env["TENANT_SECRET_ENCRYPTION_KEY"];
    process.env["TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS"] =
      env["TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS"];
    return fn();
  } finally {
    if (oldKey === undefined) delete process.env["TENANT_SECRET_ENCRYPTION_KEY"];
    else process.env["TENANT_SECRET_ENCRYPTION_KEY"] = oldKey;
    if (oldTimeout === undefined) delete process.env["TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS"];
    else process.env["TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS"] = oldTimeout;
  }
}

describe("tenant-secret-crypto provider reliability", () => {
  it("declares config and secret source evidence", () => {
    const config = loadTenantSecretCryptoProviderConfig({
      TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS: "250",
      TENANT_SECRET_CRYPTO_RETRY_ATTEMPTS: "1",
      TENANT_SECRET_CRYPTO_RETRY_BACKOFF_MS: "0",
    });

    assert.equal(config.operationTimeoutMs, 250);
    assert.equal(config.retryAttempts, 1);
    assert.equal(
      config.configSource,
      "TENANT_SECRET_ENCRYPTION_KEY|TENANT_SECRET_ENCRYPTION_KEY_FILE"
    );
    assert.equal(
      config.secretSource,
      "TENANT_SECRET_ENCRYPTION_KEY|TENANT_SECRET_ENCRYPTION_KEY_FILE"
    );
  });

  it("encrypts/decrypts with configured key and health-checks the provider", () => {
    withEnv({ TENANT_SECRET_ENCRYPTION_KEY: KEY }, () => {
      const stored = encryptTenantSecret("secret-value");
      assert.match(stored, /^enc:/);
      assert.equal(decryptTenantSecret(stored), "secret-value");
      assert.deepEqual(tenantSecretCryptoHealthCheck(), {
        status: "ready",
        provider: "tenant-secret-crypto",
      });
    });
  });

  it("health check fails closed for missing or malformed key material", () => {
    withEnv({ TENANT_SECRET_ENCRYPTION_KEY: "" }, () => {
      assert.throws(
        () => tenantSecretCryptoHealthCheck(),
        /tenant-secret-crypto health unavailable; no fallback.*fail-closed.*retry/
      );
    });
    withEnv({ TENANT_SECRET_ENCRYPTION_KEY: "z".repeat(64) }, () => {
      assert.throws(
        () => tenantSecretCryptoHealthCheck(),
        /tenant-secret-crypto health unavailable; no fallback.*fail-closed.*retry/
      );
    });
    assert.match(tenantSecretCryptoRecoveryAction(), /TENANT_SECRET_ENCRYPTION_KEY/);
  });

  it("encrypted ciphertext cannot be decrypted without the bootstrap key", () => {
    const stored = withEnv({ TENANT_SECRET_ENCRYPTION_KEY: KEY }, () =>
      encryptTenantSecret("secret-value")
    );
    withEnv({ TENANT_SECRET_ENCRYPTION_KEY: "" }, () => {
      assert.throws(
        () => decryptTenantSecret(stored),
        /TENANT_SECRET_ENCRYPTION_KEY required to decrypt/
      );
    });
  });
});
