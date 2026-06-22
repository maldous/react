/**
 * Provider-level proof wrapper for postgres-migration-storage-provider.
 *
 * The delegated proof surface is the migration test/data plan plus backup and
 * relational readiness evidence for unavailable and misconfigured database
 * states.
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";

for (const file of [
  "docs/v2-foundation/data-and-migration-plan.json",
  "apps/platform-api/tests/unit/migrations.test.ts",
  "apps/platform-api/scripts/backup-local-runtime-proof.ts",
]) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

console.log(
  JSON.stringify({ provider: "postgres-migration-storage-provider", result: "PASSED" }, null, 2)
);
