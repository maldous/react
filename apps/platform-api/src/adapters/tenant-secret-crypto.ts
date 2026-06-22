/**
 * Tenant secret crypto (ADR-0047) — shared AES-256-GCM helpers for at-rest tenant
 * secrets. Mirrors the format used by postgres-tenant-credential-store (ADR-0041):
 *
 *   enc:<iv_hex>:<ciphertext_hex>:<tag_hex>   (AES-256-GCM)
 *   unenc:<plaintext>                          (dev mode — key absent)
 *
 * Key: TENANT_SECRET_ENCRYPTION_KEY (32-byte hex = 64 hex chars). Absent in dev →
 * stored unencrypted with a logged warning; production MUST set it. Application-level
 * AES defends against database-dump exposure, not full app-server compromise.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createLogger } from "@platform/platform-logging";
import { loadTenantEncryptionKeyHex } from "../config/bootstrap-secrets.ts";

const log = createLogger({ name: "tenant-secret-crypto" });
let _warned = false;

export interface TenantSecretCryptoProviderConfig {
  operationTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "TENANT_SECRET_ENCRYPTION_KEY|TENANT_SECRET_ENCRYPTION_KEY_FILE";
  secretSource: "TENANT_SECRET_ENCRYPTION_KEY|TENANT_SECRET_ENCRYPTION_KEY_FILE";
}

export function loadTenantSecretCryptoProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): TenantSecretCryptoProviderConfig {
  return {
    operationTimeoutMs: Number(env["TENANT_SECRET_CRYPTO_OPERATION_TIMEOUT_MS"] ?? "1000"),
    retryAttempts: Number(env["TENANT_SECRET_CRYPTO_RETRY_ATTEMPTS"] ?? "0"),
    retryBackoffMs: Number(env["TENANT_SECRET_CRYPTO_RETRY_BACKOFF_MS"] ?? "0"),
    configSource: "TENANT_SECRET_ENCRYPTION_KEY|TENANT_SECRET_ENCRYPTION_KEY_FILE",
    secretSource: "TENANT_SECRET_ENCRYPTION_KEY|TENANT_SECRET_ENCRYPTION_KEY_FILE",
  };
}

function getEncryptionKey(source: NodeJS.ProcessEnv = process.env): Buffer | null {
  const keyHex = loadTenantEncryptionKeyHex(source);
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    log.warn("TENANT_SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes); ignoring");
    return null;
  }
  if (!/^[a-fA-F0-9]+$/.test(keyHex)) {
    log.warn("TENANT_SECRET_ENCRYPTION_KEY must be hex encoded; ignoring");
    return null;
  }
  return Buffer.from(keyHex, "hex");
}

function withRetrySync<T>(
  operation: () => T,
  config: TenantSecretCryptoProviderConfig,
  unavailableMessage: string
): T {
  let lastError: unknown;
  const started = Date.now();
  for (let attempt = 0; attempt <= config.retryAttempts; attempt += 1) {
    try {
      const result = operation();
      if (Date.now() - started > config.operationTimeoutMs) {
        throw new Error(`${unavailableMessage}: operation timeout exceeded`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt >= config.retryAttempts) break;
      const until = Date.now() + config.retryBackoffMs * (attempt + 1);
      while (Date.now() < until) {
        // Synchronous crypto is CPU-local; bounded spin keeps retry behavior deterministic in tests.
      }
    }
  }
  throw new Error(
    `${unavailableMessage}; no fallback is allowed for encrypted tenant secret decrypt/health, fail-closed after retry attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export function encryptTenantSecret(plaintext: string): string {
  const config = loadTenantSecretCryptoProviderConfig();
  const key = getEncryptionKey();
  if (!key) {
    if (!_warned) {
      log.warn(
        "TENANT_SECRET_ENCRYPTION_KEY not set — tenant secrets stored unencrypted. " +
          "Set this variable in production."
      );
      _warned = true;
    }
    return `unenc:${plaintext}`;
  }
  return withRetrySync(
    () => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `enc:${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
    },
    config,
    "tenant-secret-crypto encrypt unavailable"
  );
}

export function decryptTenantSecret(stored: string): string {
  if (stored.startsWith("unenc:")) return stored.slice(6);
  if (!stored.startsWith("enc:")) throw new Error("tenant-secret-crypto: unknown format");
  const config = loadTenantSecretCryptoProviderConfig();
  const key = getEncryptionKey();
  if (!key)
    throw new Error("tenant-secret-crypto: TENANT_SECRET_ENCRYPTION_KEY required to decrypt");
  const parts = stored.slice(4).split(":");
  if (parts.length !== 3) throw new Error("tenant-secret-crypto: malformed ciphertext");
  const [ivHex, ctHex, tagHex] = parts as [string, string, string];
  return withRetrySync(
    () => {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") + decipher.final("utf8");
    },
    config,
    "tenant-secret-crypto decrypt unavailable"
  );
}

export function tenantSecretCryptoHealthCheck(source: NodeJS.ProcessEnv = process.env): {
  status: "ready";
  provider: "tenant-secret-crypto";
} {
  const config = loadTenantSecretCryptoProviderConfig(source);
  withRetrySync(
    () => {
      const key = getEncryptionKey(source);
      if (!key) {
        throw new Error("TENANT_SECRET_ENCRYPTION_KEY is absent or malformed");
      }
      const probe = "tenant-secret-crypto-health";
      const iv = Buffer.alloc(12, 1);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(probe, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const roundTrip = decipher.update(enc).toString("utf8") + decipher.final("utf8");
      if (roundTrip !== probe) throw new Error("tenant secret crypto round-trip mismatch");
    },
    config,
    "tenant-secret-crypto health unavailable"
  );
  return { status: "ready", provider: "tenant-secret-crypto" };
}

export function tenantSecretCryptoRecoveryAction(): string {
  return "operator recovery: verify TENANT_SECRET_ENCRYPTION_KEY or TENANT_SECRET_ENCRYPTION_KEY_FILE is present as 64 hex chars, rotate malformed key material through the Tier-0 bootstrap secret path, restart affected API workers, and retry tenant secret encrypt/decrypt";
}
