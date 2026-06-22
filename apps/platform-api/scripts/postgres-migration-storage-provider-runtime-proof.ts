/**
 * Provider-level proof wrapper for postgres-migration-storage-provider.
 *
 * The delegated proof surface is the migration test/data plan plus backup and
 * relational readiness evidence for unavailable and misconfigured database
 * states.
 */
import { assertPostgresMigrationStorageAssurance } from "../src/adapters/postgres-migration-storage-provider.ts";

const result = await assertPostgresMigrationStorageAssurance();

console.log(JSON.stringify(result, null, 2));
