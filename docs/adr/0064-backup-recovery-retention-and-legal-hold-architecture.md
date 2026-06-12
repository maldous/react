# ADR-0064: Backup, recovery, retention, and legal hold architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / operations

## Consulted

Operations; data; security; AI assistant (drafting, human review required).

## Context

Local backup/restore scripts are proven (`proof:backup-local`; `postgres-backup.sh` refuses non-dev/test without `ALLOW_BACKUP_ENV`, `umask 077 + chmod 600`; `postgres-restore.sh` uses `--single-transaction`, `ON_ERROR_STOP=1`). There is no scheduled/offsite backup, no point-in-time recovery, no retention enforcement, no legal hold, no residency control, and no production restore drill.

## Decision

1. **Backup/restore (build):** promote the proven local scripts to a scheduled, offsite-capable backup lifecycle writing to per-environment object storage; require a production restore drill before claiming production readiness.
2. **PITR (compose/build):** Postgres WAL archiving + pgBackRest (OSS) per environment.
3. **Retention + legal hold + residency (build):** retention jobs, legal-hold flags that suspend deletion, and residency tags; all actions audited.
4. Per-environment; backups carry the same tenant-isolation boundaries as the source data.

## Consequences

Positive: recoverable, compliant data lifecycle; builds on proven local tooling.

Negative: offsite/PITR adds infrastructure and cost; restore drills are operationally heavy.

Neutral / operational: pairs with data governance (ADR-0063) and tenant deletion/export (ADR-0066).

## Validation / evidence

Evidence level: High (data-loss risk). Existing `proof:backup-local`; production backup + restore-drill evidence required.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0248).

## References

ADR-0014, ADR-0049, ADR-0053, ADR-0063.

## Notes

Proposed; acceptance requires human review.
