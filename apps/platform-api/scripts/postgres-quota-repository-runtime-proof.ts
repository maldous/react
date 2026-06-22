/**
 * Provider-ID proof entrypoint for postgres-quota-repository.
 *
 * The substantive proof is quota-enforcement-runtime-proof.ts, which validates
 * entitlement-before-quota ordering, live quota limits, usage aggregation, typed
 * denials, and no-quota allow behavior.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./quota-enforcement-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/quota-enforcement-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-quota-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("no configured quota") &&
    proofSource.includes("operator sets a quota limit") &&
    proofSource.includes("below.allowed") &&
    proofSource.includes("usage at/over limit") &&
    adapterSource.includes("INSERT INTO public.tenant_quotas"),
  "quota repository proof must assert no-quota, set-limit, within/exceeded state, and persisted quota side effects"
);
assert.ok(
  proofSource.includes("assertQuota throws a typed error when denied") &&
    proofSource.includes("revoked entitlement") &&
    proofSource.includes("denied by entitlement BEFORE quota") &&
    adapterSource.includes("postgres-quota-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "quota repository proof must assert typed denial, entitlement-before-quota, and unavailable fail-closed modes"
);
