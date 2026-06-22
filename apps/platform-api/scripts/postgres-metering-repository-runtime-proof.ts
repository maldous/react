/**
 * Provider-ID proof entrypoint for postgres-metering-repository.
 *
 * The substantive proof is metering-runtime-proof.ts, which validates live
 * Postgres metering idempotency, entitlement gating, aggregation, tenant RLS
 * isolation, and secret-free meter event storage.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./metering-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/metering-runtime-proof.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-metering-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("first record is recorded") &&
    proofSource.includes("replay with same idempotency key is deduplicated") &&
    proofSource.includes("windowed aggregation sums quantity") &&
    proofSource.includes("RLS hides orgA's meter events from orgB's context") &&
    proofSource.includes("operator (rls_bypass) sees orgA's meter events"),
  "metering repository proof must assert record/deduplicate/aggregate state and tenant isolation side effects"
);
assert.ok(
  proofSource.includes("recording denied when tenant lacks the meter's entitlement") &&
    proofSource.includes("unknown meter key is rejected") &&
    proofSource.includes("negative quantity rejected without adjustment") &&
    adapterSource.includes("postgres-metering-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "metering repository proof must assert entitlement denial, invalid meter, negative quantity, and unavailable fail-closed modes"
);
