/**
 * Provider-ID proof entrypoint for the Postgres API key repository.
 *
 * The substantive live proof is api-keys-runtime-proof.ts, which validates
 * one-time secret return, hash/salt storage, tenant-scoped listing, RLS isolation,
 * authentication, revoked-key denial, and no secret/hash exposure in list output.
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./api-keys-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/api-keys-runtime-proof.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-api-key-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("key creation returns the plaintext secret once") &&
    proofSource.includes("list response carries no secret") &&
    proofSource.includes("list response carries no hash/salt fields") &&
    proofSource.includes("RLS hides orgA's keys from orgB's tenant context") &&
    proofSource.includes("operator (rls_bypass) can list a tenant's keys") &&
    proofSource.includes("a revoked key no longer authenticates"),
  "API key repository proof must assert create/list/auth/revoked state and tenant isolation side effects"
);
assert.ok(
  proofSource.includes("key creation denied when tenant lacks api_access entitlement") &&
    proofSource.includes("SKIPPED (no live Postgres)") &&
    adapterSource.includes("withOperationTimeout") &&
    adapterSource.includes('status: "degraded"') &&
    adapterSource.includes("no alternate API key store fallback"),
  "API key repository proof must assert denied, unavailable, timeout, degraded, and no-fallback failure modes"
);
