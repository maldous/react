/**
 * Provider-ID proof entrypoint for the Postgres event bus adapter.
 *
 * The substantive live proofs are:
 * - event-bus-runtime-proof.ts for publish, idempotency, tenant isolation, and payload safety
 * - event-worker-runtime-proof.ts for claim/process/retry/DLQ/heartbeat
 * - event-redrive-runtime-proof.ts for operator redrive routes
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./event-bus-runtime-proof.ts";
import "./event-worker-runtime-proof.ts";
import "./event-redrive-runtime-proof.ts";

const busProofSource = readFileSync("apps/platform-api/scripts/event-bus-runtime-proof.ts", "utf8");
const workerProofSource = readFileSync(
  "apps/platform-api/scripts/event-worker-runtime-proof.ts",
  "utf8"
);
const redriveProofSource = readFileSync(
  "apps/platform-api/scripts/event-redrive-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync("apps/platform-api/src/adapters/postgres-event-bus.ts", "utf8");

assert.ok(
  busProofSource.includes("publish persists a new event") &&
    busProofSource.includes("idempotent publish dedups on (org, type, key)") &&
    busProofSource.includes("tenant id is preserved through publish") &&
    busProofSource.includes("RLS hides orgA's events from orgB's tenant context") &&
    workerProofSource.includes("status → processed") &&
    workerProofSource.includes("worker heartbeat is recorded and visible"),
  "event bus proof must assert publish/process/list/heartbeat state and tenant isolation side effects"
);
assert.ok(
  busProofSource.includes("secret-bearing payload rejected at publish") &&
    workerProofSource.includes("second failure dead-letters at max_attempts") &&
    workerProofSource.includes("dead-lettered when no handler exists") &&
    redriveProofSource.includes("redrive rejects an invalid id") &&
    adapterSource.includes('status: "degraded"') &&
    adapterSource.includes("healthCheck"),
  "event bus proof must assert secret rejection, retry/DLQ, invalid redrive, and degraded health failure modes"
);
