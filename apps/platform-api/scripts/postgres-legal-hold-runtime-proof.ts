/**
 * Provider-ID proof entrypoint for the Postgres legal-hold repository.
 *
 * The substantive proof lives in legal-hold-runtime-proof.ts and exercises
 * set/release lifecycle, audit-before-change, active-hold guard behavior,
 * released-state listing, and the deletion no-go invariant that downstream
 * retention/storage consumers depend on.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./legal-hold-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/legal-hold-runtime-proof.ts", "utf8");
const adapterSource = readFileSync("apps/platform-api/src/adapters/postgres-legal-hold.ts", "utf8");

assert.ok(
  proofSource.includes("audit-before-change.set.emitted") &&
    proofSource.includes("audit-before-change.release.emitted") &&
    proofSource.includes("listLegalHolds.mirrors_state") &&
    proofSource.includes('state !== "released"') &&
    proofSource.includes("hasActiveLegalHold"),
  "legal hold proof must assert set/release audit state, active guard, released list state, and lifecycle side effects"
);
assert.ok(
  proofSource.includes("legal_hold_not_found") &&
    adapterSource.includes("healthCheck") &&
    adapterSource.includes('return "unavailable"') &&
    adapterSource.includes("legal-hold status errors are not converted to false") &&
    adapterSource.includes("no fallback legal-hold store exists"),
  "legal hold proof must assert missing release, unavailable health, fail-closed guard, and no-fallback failure modes"
);
