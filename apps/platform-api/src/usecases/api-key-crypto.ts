// ---------------------------------------------------------------------------
// API-key cryptography (ADR-0065 / ADR-ACT-0257).
//
// API keys are SERVER-generated. We store ONLY a salted (per-key) + peppered
// (server-wide) scrypt hash — never the plaintext. The plaintext secret is
// returned exactly once on creation and is unrecoverable thereafter.
//
//   secret  = "sk_<base64url(24 random bytes)>"          (shown once)
//   prefix  = "pk_<first 10 chars of the random body>"   (non-secret lookup handle)
//   hash    = scrypt(secret + serverPepper, perKeySalt)  (stored)
//
// Verification is constant-time (timingSafeEqual). The server pepper comes from
// API_KEY_PEPPER; a dev default is used locally with no production guarantee.
// ---------------------------------------------------------------------------

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { loadPlatformApiConfig } from "../config/app-config.ts";

const SECRET_PREFIX = "sk_";
const HANDLE_PREFIX = "pk_";
const SCRYPT_KEYLEN = 32;

/** Server-wide pepper. MUST be set in production; a fixed dev value is used locally. */
function serverPepper(): string {
  return loadPlatformApiConfig().apiKeyPepper;
}

export interface GeneratedApiKey {
  /** Plaintext secret — returned to the caller exactly once, never stored. */
  secret: string;
  /** Non-secret lookup handle stored in plaintext (safe to show in lists). */
  keyPrefix: string;
  /** Per-key salt (hex) stored alongside the hash. */
  keySalt: string;
  /** scrypt hash (hex) stored at rest. */
  keyHash: string;
}

function hash(secret: string, saltHex: string): string {
  return scryptSync(
    `${secret}${serverPepper()}`,
    Buffer.from(saltHex, "hex"),
    SCRYPT_KEYLEN
  ).toString("hex");
}

/** Mint a fresh API key: random secret, derived prefix, per-key salt, stored hash. */
export function generateApiKey(): GeneratedApiKey {
  const body = randomBytes(24).toString("base64url");
  const secret = `${SECRET_PREFIX}${body}`;
  const keyPrefix = `${HANDLE_PREFIX}${body.slice(0, 10)}`;
  const keySalt = randomBytes(16).toString("hex");
  return { secret, keyPrefix, keySalt, keyHash: hash(secret, keySalt) };
}

/** Recover the non-secret lookup handle from a presented plaintext secret. */
export function prefixForSecret(secret: string): string | null {
  if (!secret.startsWith(SECRET_PREFIX)) return null;
  const body = secret.slice(SECRET_PREFIX.length);
  if (body.length < 10) return null;
  return `${HANDLE_PREFIX}${body.slice(0, 10)}`;
}

/** Constant-time verification of a presented secret against a stored (salt, hash). */
export function verifyApiKey(secret: string, keySalt: string, keyHash: string): boolean {
  const candidate = Buffer.from(hash(secret, keySalt), "hex");
  const stored = Buffer.from(keyHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
