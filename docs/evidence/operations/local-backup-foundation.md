# Local Backup / Restore Foundation (ADR-ACT-0229)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed. Local-only.

## Scope delivered

A safe, guarded local Postgres backup/restore foundation (none existed before — see the
ADR-ACT-0227 bedrock review).

- **`scripts/backup/postgres-backup.sh`** — `pg_dump --no-owner --no-privileges` for the
  given `ENV`, gzipped to `.local-artifacts/backups/<env>-<ts>.sql.gz` (an ignored dir),
  printing the output path. `POSTGRES_URL`/`.env.<ENV>`/dev-default resolution; `BACKUP_DIR`
  override.
- **`scripts/backup/postgres-restore.sh`** — GUARDED + destructive: refuses unless **both**
  `ENV ∈ {dev,test}` **and** `CONFIRM_RESTORE=restore-<ENV>` are supplied, and the backup
  file exists. Restores via `gunzip -c | psql`.
- **Make targets** — `make db-backup ENV=test` and
  `make db-restore ENV=test CONFIRM_RESTORE=restore-test BACKUP_FILE=…` (added to `.PHONY`).
- **`.gitignore`** — `.local-artifacts/` so backup files are never committed.
- **`proof:backup-local`** — integrity proof (does NOT run a full destructive restore).

## Decisions

- **Backup integrity is proven, not full restore.** A full restore overwrites the database;
  the proof instead seeds a unique marker, dumps, and asserts the marker is in the dump,
  plus asserts the restore guard refuses. This is honest and non-destructive.
- The restore guard is intentionally hard to fire (dev/test only + an exact confirm token)
  to prevent accidental data loss.
- Backups land under an ignored local-artifact dir; never committed.

## Tests run (with proof layer)

- Runtime proof `proof:backup-local` (live Postgres + host `pg_dump`/`psql`):

```text
# Local backup integrity runtime proof

PASS  seeded temp org with unique marker
PASS  backup script produced a gzipped dump
PASS  backup contains the seeded marker (integrity)
PASS  backup is non-trivial in size — 30470 bytes
PASS  restore script REFUSES without ENV=dev|test + CONFIRM_RESTORE
PASS  cleanup removed the temp org + backup artifacts

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- **Live-proven (against live Postgres + host pg_dump):** a real dump is produced, contains
  the seeded marker (integrity), and the restore guard refuses an unconfirmed/prod restore.
- NOT proven (deliberately): a full destructive restore round-trip (would overwrite the DB);
  the guard + integrity are proven instead. Documented limitation.

## Known deferrals

- A full restore round-trip proof (needs a throwaway/ephemeral database to restore into).
- Scheduled/automated backups, retention/rotation, and off-host/object-store backup targets.
- Per-tenant logical backup (this is a whole-database dump).

## No-secret / no-leak guarantee

The proof greps the dump for a marker but NEVER prints dump contents. Backups (which
contain DB data, including encrypted-at-rest secrets) are written only to the ignored
`.local-artifacts/` dir and are never committed (`.gitignore`). The scripts print only the
output path + status, never connection strings or data.

## No-fake-readiness guarantee

The integrity check reads the actual produced dump; the guard test invokes the real restore
script and asserts refusal. Nothing is simulated.

## ACTION-REGISTER linkage

ADR-ACT-0229 (Source: ADR-ACT-0227 review). Evidence: this file.
