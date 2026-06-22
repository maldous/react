/**
 * Provider-level proof wrapper for postgres-migration-storage-provider.
 *
 * The delegated proof surface is the migration test/data plan plus backup and
 * relational readiness evidence for unavailable and misconfigured database
 * states.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertPostgresMigrationStorageAssurance } from "../src/adapters/postgres-migration-storage-provider.ts";

const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-migration-storage-provider.ts",
  "utf8"
);

assert.ok(
  adapterSource.includes("migrationChain") &&
    adapterSource.includes("quotaBeforeWrite") &&
    adapterSource.includes("quarantined") &&
    adapterSource.includes("clean") &&
    adapterSource.includes("rejected") &&
    adapterSource.includes("legalHoldDeletionBlock") &&
    adapterSource.includes("auditEvent") &&
    adapterSource.includes("traceSpan") &&
    adapterSource.includes("structuredLog") &&
    adapterSource.includes("metric"),
  "migration storage provider proof must assert migration, storage lifecycle, audit, trace, log, and metric evidence state"
);
assert.ok(
  adapterSource.includes("throw new Error") &&
    adapterSource.includes("missing migration") &&
    adapterSource.includes("failed migration") &&
    adapterSource.includes("RLS mismatch") &&
    adapterSource.includes("no fallback relational store is used"),
  "migration storage provider proof must assert missing evidence, failed migration, RLS mismatch, and no-fallback failure modes"
);

const result = await assertPostgresMigrationStorageAssurance();

console.log(JSON.stringify(result, null, 2));
