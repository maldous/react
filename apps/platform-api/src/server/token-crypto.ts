import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createLogger } from "@platform/platform-logging";

const log = createLogger({ name: "token-crypto" });

// Warn once if encryption key is absent.
let _warnedAboutMissingKey = false;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    log.warn(
      "TENANT_SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes); token encryption disabled"
    );
    return null;
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a token string using AES-256-GCM.
 * Format: enc:<iv_hex>:<ciphertext_hex>:<tag_hex>
 * If key absent: unenc:<plaintext> (logged warning in dev).
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (!_warnedAboutMissingKey) {
      log.warn(
        "TENANT_SECRET_ENCRYPTION_KEY not set — session tokens stored unencrypted. Set this in production."
      );
      _warnedAboutMissingKey = true;
    }
    return `unenc:${plaintext}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/**
 * Decrypt a token string produced by encryptToken().
 * Throws if the ciphertext is malformed or the key is unavailable for an encrypted value.
 */
export function decryptToken(stored: string): string {
  if (stored.startsWith("unenc:")) return stored.slice(6);
  if (!stored.startsWith("enc:")) throw new Error("token-crypto: unknown format");

  const key = getEncryptionKey();
  if (!key) throw new Error("token-crypto: TENANT_SECRET_ENCRYPTION_KEY required to decrypt");

  const parts = stored.slice(4).split(":");
  if (parts.length !== 3) throw new Error("token-crypto: malformed ciphertext");
  const [ivHex, ctHex, tagHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

/**
 * Called at startup. Throws in production if the encryption key is absent or malformed.
 */
export function assertEncryptionKeyConfigured(): void {
  const keyHex = process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  const valid = typeof keyHex === "string" && keyHex.length === 64;
  if (
    !valid &&
    (process.env["NODE_ENV"] === "production" || process.env["PLATFORM_ENV"] === "production")
  ) {
    throw new Error(
      "TENANT_SECRET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
        "Session tokens cannot be stored encrypted without it."
    );
  }
  if (!valid) {
    log.warn(
      "TENANT_SECRET_ENCRYPTION_KEY not set or invalid — token encryption disabled. Set this before deploying to production."
    );
  }
}
