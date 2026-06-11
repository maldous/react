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

const log = createLogger({ name: "tenant-secret-crypto" });
let _warned = false;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env["TENANT_SECRET_ENCRYPTION_KEY"];
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    log.warn("TENANT_SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes); ignoring");
    return null;
  }
  return Buffer.from(keyHex, "hex");
}

export function encryptTenantSecret(plaintext: string): string {
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
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptTenantSecret(stored: string): string {
  if (stored.startsWith("unenc:")) return stored.slice(6);
  if (!stored.startsWith("enc:")) throw new Error("tenant-secret-crypto: unknown format");
  const key = getEncryptionKey();
  if (!key)
    throw new Error("tenant-secret-crypto: TENANT_SECRET_ENCRYPTION_KEY required to decrypt");
  const parts = stored.slice(4).split(":");
  if (parts.length !== 3) throw new Error("tenant-secret-crypto: malformed ciphertext");
  const [ivHex, ctHex, tagHex] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") + decipher.final("utf8");
}
