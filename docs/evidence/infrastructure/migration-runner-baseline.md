# Migration Runner Hardening Baseline Evidence

**Date:** 2026-05-28
**ADR references:** ADR-ACT-0116, ADR-0014, ADR-0017

## Summary

Hardened the migration runner (`apps/platform-api/src/db/migrate.ts`) with:

- `schema_migrations` tracking table for applied migrations
- SHA-256 checksum per migration file (truncated to 16 hex chars)
- Idempotent run: skips already-applied migrations by name
- Transaction-per-migration with rollback on failure
- `isMigrated()` exported function for readiness checks
- `seedFixtures()` guards via `isMigrated()` before seeding

## Files changed

| File | Change |
| ---- | ------ |
| `apps/platform-api/src/db/migrate.ts` | Full rewrite with tracking table and idempotency |
| `apps/platform-api/src/db/seed.ts` | Added `isMigrated()` guard before insert |
| `apps/platform-api/src/db/reset.ts` | Drop `schema_migrations` in reset |
| `apps/platform-api/src/db/index.ts` | Export `isMigrated` |

## API changes

`runMigrations()` now returns `{ applied: string[]; skipped: string[] }` instead of `void`.

## Tests

Added to `tests/integration/compose-smoke.test.mjs`:

| Test | Description |
| ---- | ----------- |
| `database: migration runner creates schema_migrations table` | Verifies tracking table exists after run |
| `database: migration is idempotent (skips already applied)` | Second run returns `applied=0, skipped>0` |
| `database: seed requires migrated schema` | `seedFixtures()` rejects on unmigrated DB |

## Gate compliance

- ADR-0014: Data schema ownership enforced via migration tracking
- ADR-0017: Local substrate migration idempotency required for compose dev workflow
