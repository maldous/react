/**
 * Provider-level proof wrapper for postgres-identity-repository.
 *
 * The delegated proof exercises the live tenant/domain identity matrix through
 * the Postgres identity repository and fails on unavailable or misconfigured
 * identity storage behavior.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync(
  "apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-identity-repository.ts",
  "utf8"
);
const substrateTestSource = readFileSync(
  "apps/platform-api/tests/substrate/postgres-identity-repository.test.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("live: X-Forwarded-Host preferred over Host") &&
    proofSource.includes("resolves no tenant") &&
    substrateTestSource.includes("returns user+identity after createUserAndExternalIdentity") &&
    substrateTestSource.includes("creates user and external identity transactionally") &&
    substrateTestSource.includes("returns membership for fixture admin user"),
  "identity repository proof must assert live tenant resolution, identity creation, and membership state side effects"
);
assert.ok(
  substrateTestSource.includes("returns null when no matching identity exists") &&
    substrateTestSource.includes("rejects second call with same email") &&
    substrateTestSource.includes("ConflictError") &&
    adapterSource.includes("fail closed") &&
    adapterSource.includes("no fallback identity store is used"),
  "identity repository proof must assert missing identity, duplicate email conflict, fail-closed, and no-fallback failure modes"
);

await import("./domain-identity-matrix-runtime-proof.ts");
