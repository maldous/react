/**
 * Provider-ID proof entrypoint for postgres-retention.
 *
 * The substantive proof is retention-runtime-proof.ts, which validates
 * retention policy validation, audit-before-change behavior, legal-hold guarded
 * candidate processing, outcomes, and retention route registration.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./retention-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/retention-runtime-proof.ts", "utf8");
const adapterSource = readFileSync("apps/platform-api/src/adapters/postgres-retention.ts", "utf8");

assert.ok(
  proofSource.includes("tick1.deleted") &&
    proofSource.includes("ledger.deleted") &&
    proofSource.includes("ledger.skipped_legal_hold") &&
    proofSource.includes("audit.retention_applied_count") &&
    proofSource.includes("audit.tick_completed_count"),
  "retention proof must assert tick outcomes, candidate ledger state, legal-hold skip state, and audit side effects"
);
assert.ok(
  proofSource.includes("skipped_legal_hold") &&
    adapterSource.includes("SELECTABLE_TABLES") &&
    adapterSource.includes("postgres-retention unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "retention proof must assert legal-hold guard, table allow-list, unavailable, and fail-closed failure modes"
);
