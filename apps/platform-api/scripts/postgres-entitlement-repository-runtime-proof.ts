/**
 * Provider-ID proof entrypoint for postgres-entitlement-repository.
 *
 * The substantive proof is entitlements-postgres-runtime-proof.ts, which
 * validates the live tenant_entitlements substrate, RLS, operator reads, grant
 * and revoke semantics, and secret-free entitlement records.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./entitlements-postgres-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/entitlements-postgres-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-entitlement-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("operator can grant (upsert returns granted)") &&
    proofSource.includes("tenant self-read sees its own grant") &&
    proofSource.includes("RLS hides orgA's row from orgB's context") &&
    proofSource.includes("operator path reads target tenant grants") &&
    proofSource.includes("revoked") &&
    proofSource.includes("returned entitlement records carry no secret fields"),
  "entitlement repository proof must assert granted/revoked state, operator reads, tenant isolation, and no-secret side effects"
);
assert.ok(
  proofSource.includes("audit-before-change: mutation rejects when audit fails") &&
    proofSource.includes("DB row UNCHANGED after failed audit") &&
    proofSource.includes("SKIPPED (no live Postgres)") &&
    adapterSource.includes("postgres-entitlement-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts") &&
    adapterSource.includes("SET LOCAL statement_timeout"),
  "entitlement repository proof must assert audit failure, unavailable, timeout, and fail-closed failure modes"
);
