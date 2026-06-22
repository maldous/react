/**
 * Provider-ID proof entrypoint for postgres-rate-limit-repository.
 *
 * The substantive proof is rate-limits-runtime-proof.ts, which validates live
 * Postgres rate-limit policy mutation, entitlement-before-counting, allow/deny
 * fixed-window behavior, tenant RLS isolation, and secret-free records.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./rate-limits-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/rate-limits-runtime-proof.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-rate-limit-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("rate-limit set is audited") &&
    proofSource.includes("first request allowed") &&
    proofSource.includes("second request allowed") &&
    proofSource.includes("third request denied") &&
    proofSource.includes("list reports the policy with the live window count"),
  "rate-limit repository proof must assert audited policy mutation, allow/deny fixed-window state, and live list side effects"
);
assert.ok(
  proofSource.includes("not-entitled tenant denied at the entitlement step") &&
    proofSource.includes("RLS hides orgA's policies from orgB's tenant context") &&
    proofSource.includes("has no secret-bearing columns") &&
    adapterSource.includes("postgres-rate-limit-repository unavailable") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "rate-limit repository proof must assert entitlement denial, tenant isolation, no-secret records, and unavailable fail-closed modes"
);
