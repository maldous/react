/**
 * Provider reliability evidence for local Postgres backup/restore scripts.
 *
 * Runtime behavior is implemented by scripts/backup/postgres-backup.sh and
 * scripts/backup/postgres-restore.sh and exercised by backup runtime proofs.
 */
export const backupRestoreScriptsReliabilityEvidence = {
  configSource:
    "process.env and proof-script arguments supply database URL, output directory, restore target, and confirmation gates",
  secretSource:
    "database credential material is supplied through POSTGRES_APP_URL/managed environment secrets and is never written to proof output",
  timeout:
    "backup/restore proof commands are bounded by stage execution timeouts and fail on hung subprocesses",
  retry:
    "operator retry is explicit after repairing database connectivity, disk space, or confirmation inputs; restore does not auto-retry destructive work",
  degradedMode:
    "backup readiness degrades or fails when dump/restore prerequisites are missing instead of reporting a successful backup",
  failClosed:
    "restore refuses protected environments, missing confirmation, unsafe transaction flags, and invalid dump files",
  fallbackRationale:
    "no fallback backup mechanism is claimed; pg_dump/pg_restore scripts are the only represented provider for this capability",
  healthCheck:
    "backup-local and backup-control-route proofs validate dump integrity, guarded restore semantics, and route behavior",
  operatorRecovery:
    "operator recovery: verify pg_dump/pg_restore binaries, POSTGRES_APP_URL, disk permissions, protected environment guards, then rerun backup proofs",
};
