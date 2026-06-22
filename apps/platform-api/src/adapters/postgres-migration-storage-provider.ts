/**
 * Provider reliability evidence for relational storage, migrations, and RLS.
 *
 * Runtime behavior is provided by the platform Postgres substrate, migration
 * runner, migration tests, RLS probes, and data/migration plan gates.
 */
export const postgresMigrationStorageProviderReliabilityEvidence = {
  configSource:
    "process.env POSTGRES_APP_URL, migration plan, db/migrations, and stage database configuration supply relational storage setup",
  secretSource:
    "POSTGRES_APP_URL is the secret-bearing database credential source; migration and RLS proofs never return credentials",
  timeout:
    "migration, readiness, and database proof commands are bounded by stage/test execution timeouts and statement timeout handling",
  retry:
    "operator retry is explicit after repairing database connectivity, migration ordering, or RLS/grant failures",
  degradedMode:
    "missing database, failed migration, or RLS mismatch leaves relational storage unassured instead of ready",
  failClosed:
    "migration plan, RLS, backup, and readiness gates exit non-zero on missing or inconsistent relational storage state",
  fallbackRationale:
    "no fallback relational store is used; Postgres migrations and RLS are the sole V1 semantic storage substrate",
  healthCheck:
    "migrations tests, data-and-migration plan checks, readiness probes, backup proofs, and RLS tests exercise relational storage",
  operatorRecovery:
    "operator recovery: verify POSTGRES_APP_URL, migration chain, grants/RLS, run migrations, then rerun storage and readiness proofs",
};
