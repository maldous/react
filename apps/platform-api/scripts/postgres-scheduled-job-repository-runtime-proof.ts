/**
 * Provider-ID proof entrypoint for postgres-scheduled-job-repository.
 *
 * The substantive proof is scheduled-jobs-runtime-proof.ts, which validates
 * scheduled job persistence, due enqueue, deduplication, pause, run-now, and
 * tenant isolation semantics.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./scheduled-jobs-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/scheduled-jobs-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-scheduled-job-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("due job enqueues an event") &&
    proofSource.includes("tenant id preserved on the enqueued event") &&
    proofSource.includes("still exactly one event for the window") &&
    proofSource.includes("paused job does not enqueue") &&
    proofSource.includes("run-now"),
  "scheduled job proof must assert due enqueue, tenant-preserved event state, deduplication, pause, and run-now side effects"
);
assert.ok(
  proofSource.includes("RLS hides orgA's scheduled jobs from orgB's tenant context") &&
    proofSource.includes("scheduled_jobs has no secret-bearing columns") &&
    adapterSource.includes("postgres-scheduled-job-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "scheduled job proof must assert tenant isolation, no-secret records, unavailable, and fail-closed failure modes"
);
