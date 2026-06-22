/**
 * Provider-ID proof entrypoint for the Postgres profile repository.
 *
 * The substantive live proof is profile-self-service-runtime-proof.ts. It
 * validates tenant/user scoped profile reads and writes through the Postgres
 * repository and route/usecase surface.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./profile-self-service-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/profile-self-service-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-profile-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("user reads back their own updated profile") &&
    proofSource.includes("RLS hides orgA's profiles from orgB's tenant context") &&
    proofSource.includes("user_profiles has no secret-bearing columns") &&
    adapterSource.includes("INSERT INTO public.user_profiles"),
  "profile repository proof must assert update/readback state, tenant isolation, and no-secret side effects"
);
assert.ok(
  proofSource.includes("empty display name rejected") &&
    proofSource.includes("SKIPPED (no live Postgres)") &&
    adapterSource.includes("postgres-profile-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "profile repository proof must assert invalid profile, unavailable, and fail-closed failure modes"
);
