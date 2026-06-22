/**
 * Provider-ID proof entrypoint for postgres-portable-tenant-import-applier.
 *
 * The substantive proof is data-portability-runtime-proof.ts, which validates
 * encrypted archive import/export, manifest/digest verification, rollback,
 * resume progress, and durable portable import application semantics.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./data-portability-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/data-portability-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-portable-tenant-import-applier.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("tenant export route registered") &&
    proofSource.includes("tenant import route registered") &&
    proofSource.includes("completed.completedOrders") &&
    proofSource.includes("durable.completedOrders") &&
    adapterSource.includes("portable_import_progress"),
  "portable import proof must assert route registration, resume progress, and durable import state side effects"
);
assert.ok(
  proofSource.includes("assert.rejects") &&
    proofSource.includes("tamper rejected") &&
    adapterSource.includes("unsupported portable tenant entry") &&
    adapterSource.includes("domain belongs to another tenant") &&
    adapterSource.includes("unavailable") &&
    adapterSource.includes("fail-closed with no fallback"),
  "portable import proof must assert tamper rejection, unsupported entry, domain conflict, and unavailable fail-closed modes"
);
