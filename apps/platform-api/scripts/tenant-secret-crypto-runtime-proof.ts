/**
 * Provider-ID proof entrypoint for tenant-secret-crypto.
 *
 * The substantive proof is secret-store-contract-runtime-proof.ts, which validates
 * tenant secret encryption/decryption behavior, non-secret storage contracts, and
 * fail-closed decrypt behavior when encrypted material cannot be opened.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync(
  "apps/platform-api/scripts/secret-store-contract-runtime-proof.ts",
  "utf8"
);
const cryptoSource = readFileSync("apps/platform-api/src/adapters/tenant-secret-crypto.ts", "utf8");

assert.ok(
  proofSource.includes("value is stored encrypted/escaped at rest") &&
    proofSource.includes("resolve returns the rotated value") &&
    proofSource.includes("deleted secret has no metadata") &&
    cryptoSource.includes("encryptTenantSecret"),
  "tenant secret crypto wrapper must assert encrypted storage, rotation, delete state, and encryption side effects"
);
assert.ok(
  proofSource.includes("revoked secret no longer resolves") &&
    proofSource.includes("tenant B cannot resolve tenant A's ref") &&
    cryptoSource.includes("decryptTenantSecret"),
  "tenant secret crypto wrapper must assert revoked/foreign secret failure modes"
);

import "./secret-store-contract-runtime-proof.ts";
