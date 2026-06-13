# ADR-0064: Backup, recovery, retention, and legal hold architecture

## Status

Accepted (2026-06-13, ADR-ACT-0268 — governance hardening; accepted on Matt's authority per the directive). The local backup scripts (`proof:backup-local`) are the only delivered element. Scheduled/offsite backup, PITR, pgBackRest, retention enforcement, legal hold, residency controls, and a production restore drill are **NOT delivered** — they are Proposed sub-decisions.

## Date

2026-06-13

## Decision owner

Architecture owner / operations

## Consulted

Operations; data; security; AI assistant (drafting, human review required).

## Context

Local backup/restore scripts are proven: `postgres-backup.sh` (refuses non-dev/test without `ALLOW_BACKUP_ENV`, `umask 077 + chmod 600`) and `postgres-restore.sh` (`--single-transaction`, `ON_ERROR_STOP=1`) pass `proof:backup-local`. However there is no scheduled backup, no offsite/cloud backup destination, no point-in-time recovery (PITR), no retention enforcement, no legal hold that suspends deletion, no data residency controls, and no production restore drill. These gaps are blockers for production data-loss confidence and for safe tenant deletion (ADR-0066) and DSR erasure (ADR-0063). The Phase-0 ADR decision-quality assessment (ADR-ACT-0252) identified missing acceptance criteria and an unresolved pgBackRest decision as the key gaps. This hardened version closes both.

## Decision (delivered)

**Local backup/restore scripts (`proof:backup-local`):** `postgres-backup.sh` + `postgres-restore.sh` proven against local Postgres. Secure defaults (`umask 077`, `chmod 600`, `--single-transaction`, `ON_ERROR_STOP=1`). Non-dev/test environments refuse without `ALLOW_BACKUP_ENV`. This is the only delivered element.

## Decision (Proposed sub-decisions — NOT delivered)

### Sub-decision 1: Scheduled offsite backup to object storage (build)

Promote the proven local scripts to a scheduled, offsite-capable backup lifecycle. Backups write to per-environment object storage (MinIO for local/staging; S3-compatible for production). Schedule: at minimum daily full + continuous WAL archiving (when sub-decision 2 is enabled). Backup files carry the same tenant-isolation boundary as the source data — a backup of the full database is not a per-tenant backup; per-tenant export is a separate capability (ADR-0063 sub-decision 4). Environment classification: `per-environment` (backups are per-environment, never shared across environments).

### Sub-decision 2: PITR via WAL archiving + pgBackRest (compose / build)

Enable Postgres WAL archiving and deploy **pgBackRest** (OSS, permissive licence) as the PITR and backup management layer. pgBackRest writes WAL segments and base backups to the same per-environment object storage as sub-decision 1. Selection rationale: pgBackRest is the de-facto OSS Postgres PITR tool; it supports S3/MinIO backends natively; it is free to run locally and in production. Alternative (WAL-E/WAL-G): WAL-G is also a valid OSS choice; the decision between pgBackRest and WAL-G is resolved at Phase-8 implementation time based on MinIO compatibility and operational familiarity — both are acceptable. Barman is heavier and is rejected for this platform's footprint.

### Sub-decision 3: Retention enforcement + object lifecycle (build)

Build a retention job that enforces per-environment retention policies on backup objects (MinIO/S3 object lifecycle rules) and on database rows where a retention period is configured. Retention periods are operator-set, per-environment, and audited. Retention enforcement must coordinate with legal hold (sub-decision 4): a held object or row is exempt from deletion until the hold is lifted. The MinIO object lifecycle policy is the enforcement mechanism for object storage; a Postgres-side retention job handles row-level enforcement.

### Sub-decision 4: Legal hold (build)

Build a `LegalHoldPort` that flags a tenant, a set of rows, or an export object as held. Holds are operator-initiated, time-bounded or indefinite, and audited. An active hold on a tenant blocks: (a) DSR erasure (ADR-0063 sub-decision 3), (b) tenant deletion (ADR-0066), (c) retention-driven deletion of held rows/objects. Holds are released by an explicit operator action (audited). The hold state is stored in Postgres with RLS; the hold is enforced at every deletion / erasure code path that could affect the held entity.

### Sub-decision 5: Data residency controls (build)

Build residency tags on tenant records and enforce that backups and exports for a tagged tenant write only to a residency-approved object storage bucket / region. Residency tags are operator-set, audited, and enforced at backup + export time. The enforcement mechanism is a pre-write check in the backup/export code path. Residency enforcement is a production-hardening step; it is not required for local proof.

### Sub-decision 6: Production restore drill (operational / build)

A production restore drill is required before claiming production backup readiness. The drill must: (a) restore a backup to an isolated environment, (b) verify data integrity (row counts + sample queries), (c) document the RTO/RPO achieved, and (d) produce a signed evidence document in `docs/evidence/platform/`. The drill must be repeated after any material change to the backup infrastructure. `proof:restore-drill` is a semi-automated proof that exercises the restore path against a staging environment.

### Alternatives considered

1. **pgBackRest for PITR (primary choice).** Mature OSS, S3/MinIO native, free local runner. Selected over WAL-G (also valid, decision deferred to Phase 8) and Barman (heavier, rejected).
2. **WAL-G instead of pgBackRest.** Valid OSS alternative with a smaller binary footprint. Not rejected — the Phase-8 spike will resolve the choice. Both are recorded here as acceptable.
3. **MinIO object lifecycle for retention enforcement.** Native object lifecycle policies are the right mechanism for object storage retention; no custom job is needed for object-layer enforcement. Row-level retention requires a custom Postgres job.
4. **Managed backup service (RDS Automated Backups / Cloud SQL).** Out of scope for the local stack; acceptable as a production complement but the platform must have an OSS-runnable PITR path that does not require a managed database service.
5. **Legal hold as a Keycloak attribute.** Rejected — holds operate on data rows and backup objects, not identity attributes; the hold state belongs in the platform's Postgres store.
6. **Residency via Keycloak realm geography.** Rejected — residency is a data-placement control, not an identity control; enforcement must be at backup/export write time.

### Rejected alternatives (required)

- **No production restore drill before claiming production backup readiness** — rejected: a backup that has never been restored is not a proven backup; `proof:restore-drill` is a hard gate.
- **Shared backup storage across environments** — rejected: backups are `per-environment`; staging backups must never mix with production backups.
- **ALLOW_BACKUP_ENV bypass in CI without an explicit gate** — rejected: the guard is a safety invariant; bypassing it requires an explicit operator action.
- **Legal hold stored only in application memory or a feature flag** — rejected: hold state must be durable (Postgres), RLS-isolated, and audited; in-memory or flag-based holds are not recoverable after a restart.
- **Retention enforcement that ignores legal holds** — rejected: a held object or row is exempt from deletion; enforcement code must check hold state before deleting.
- **pgBackRest in production without a sealed/hardened configuration** — rejected as a production-readiness gate (analogous to OpenBao -dev mode in ADR-0069); a local pgBackRest dev configuration is not production.

### Accepted decision

Adopt the six sub-decisions in dependency order: local scripts (delivered) → scheduled offsite backup → pgBackRest PITR (Phase 8, pgBackRest vs WAL-G resolved at spike) → retention + legal hold → residency → production restore drill. Legal hold is the highest-priority undelivered element because it gates DSR erasure and tenant deletion.

## Implementation phases

1. **Phase 8a — Scheduled offsite backup:** promote scripts to MinIO sink; daily schedule; `proof:backup-offsite` (live MinIO + Postgres).
2. **Phase 8b — pgBackRest PITR:** WAL archiving enabled; pgBackRest sidecar in compose; `proof:pitr` (point-in-time restore to an isolated schema, data integrity verified).
3. **Phase 8c — Legal hold:** `LegalHoldPort` + Postgres table (RLS); hold enforcement in erasure / deletion / retention code paths; `proof:legal-hold` (live Postgres — hold blocks erasure, deletion, and retention-driven delete).
4. **Phase 8d — Retention enforcement:** MinIO object lifecycle rules + Postgres retention job; hold exemption enforced; `proof:retention` (live MinIO + Postgres — expired objects deleted, held objects exempt).
5. **Phase 8e — Residency controls:** residency tags + pre-write enforcement in backup/export; `proof:residency` (live Postgres + MinIO — tagged tenant's backup writes only to approved bucket).
6. **Phase 8f — Production restore drill:** semi-automated `proof:restore-drill`; staging restore; RTO/RPO documented; evidence in `docs/evidence/platform/backup-restore-drill.md`.

## Acceptance criteria

### Sub-decision 1 (scheduled offsite)

- A scheduled backup writes a timestamped, encrypted dump to per-environment MinIO; a subsequent restore from that backup passes data-integrity checks; the environment guard (`ALLOW_BACKUP_ENV`) is enforced; `proof:backup-offsite` passes against live MinIO + Postgres.

### Sub-decision 2 (PITR / pgBackRest)

- WAL segments are archived to MinIO continuously; a base backup + WAL replay restores the database to a named point in time; the restored schema passes row-count and sample-query integrity checks; `proof:pitr` passes.

### Sub-decision 3 (retention)

- Expired backup objects are deleted by MinIO lifecycle policy; expired rows are deleted by the retention job; held objects and rows are exempt; retention actions are audited; `proof:retention` passes.

### Sub-decision 4 (legal hold)

- An operator-initiated hold blocks DSR erasure, tenant deletion, and retention-driven deletion for the held entity; the hold is released by an explicit operator action; hold state survives a restart; hold creation and release are audited; `proof:legal-hold` passes against live Postgres.

### Sub-decision 5 (residency)

- A residency-tagged tenant's backup and export writes only to a residency-approved bucket; a write to a non-approved bucket fails at the pre-write check; residency tag changes are audited; `proof:residency` passes.

### Sub-decision 6 (restore drill)

- A full restore from a recent backup to an isolated environment completes without error; row counts and sample queries match the source; RTO is documented; the evidence document is signed and committed to `docs/evidence/platform/`; `proof:restore-drill` passes.

## Proof requirements

`proof:backup-local` (existing, passing), `proof:backup-offsite` (MinIO + Postgres — encrypted dump, restore, integrity check), `proof:pitr` (WAL + pgBackRest — point-in-time restore, integrity), `proof:legal-hold` (Postgres — hold blocks erasure/deletion/retention, release audited), `proof:retention` (MinIO + Postgres — expired deleted, held exempt), `proof:residency` (Postgres + MinIO — tagged bucket enforcement), `proof:restore-drill` (staging — full restore, RTO documented). No sub-decision may be claimed delivered without its named proof. A skipped proof (infrastructure unavailable) is not a passed proof and must not advance the capability status.

## Production blockers

- No scheduled/offsite backup: the local scripts are dev/test only.
- No PITR: WAL archiving is not enabled; pgBackRest is not composed.
- No legal hold: any DSR erasure or tenant deletion today is permanent with no hold check.
- No retention enforcement: object lifecycle and row-level retention are both absent.
- No residency controls: per-tenant data placement is not enforced.
- **No production restore drill**: `proof:backup-local` proves a local dump/restore; it does not prove production recoverability or an acceptable RTO/RPO.
- pgBackRest choice is confirmed (pgBackRest vs WAL-G resolved at Phase-8 spike; both acceptable); a running pgBackRest sidecar in a production topology is not a dev container with default settings.

## Consequences

Positive: builds on proven local tooling; pgBackRest is OSS and free-runnable locally; legal hold gates DSR and tenant deletion safely; the restore drill closes the gap between "backup exists" and "backup is proven".

Negative: offsite/PITR adds infrastructure complexity and object storage cost; restore drills are operationally heavy; the legal hold enforcement path must be threaded through erasure, deletion, and retention code — missing any one path is a compliance gap.

Neutral / operational: backups are per-environment (never shared); holds are durable and audited; residency enforcement is a pre-write check. Couples with ADR-0063 (DSR/legal-hold coordination) and ADR-0066 (tenant deletion).

## Validation / evidence

Evidence level: High (data-loss risk). `proof:backup-local` is the only existing evidence. All other proofs are to be created at Phase-8 implementation time. Evidence location: `docs/evidence/platform/` (per sub-decision). A sub-decision is not claimed delivered until its proof passes and an evidence document is committed.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md`: ADR-ACT-0248 (original delivery tracking), ADR-ACT-0268 (this hardening). Phase-8 spike for pgBackRest vs WAL-G to be added when Phase 8 is scheduled.

## References

ADR-0014, ADR-0029, ADR-0049, ADR-0053, ADR-0056, ADR-0063, ADR-0066.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0268) on Matt's authority per the directive. The only delivered element is `proof:backup-local`. Scheduled/offsite backup, PITR, legal hold, retention, residency, and restore drill are all undelivered Proposed sub-decisions. pgBackRest is the primary PITR choice; WAL-G remains a valid alternative (choice resolved at Phase-8 spike). Legal hold is the highest-priority undelivered element because it gates DSR erasure and tenant deletion. A production restore drill is a hard gate before production backup readiness is claimed.
