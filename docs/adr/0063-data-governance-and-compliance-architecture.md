# ADR-0063: Data governance and compliance architecture

## Status

Accepted (2026-06-13, ADR-ACT-0267 — governance hardening; accepted on Matt's authority per the directive). All capabilities described here are **NOT delivered** — they are Proposed sub-decisions. This ADR is accepted as a decision-quality governance record; no implementation has occurred.

## Date

2026-06-13

## Decision owner

Architecture owner / data / security / legal-compliance

## Consulted

Data; security; legal/compliance stakeholder; engineering; AI assistant (drafting, human review required).

## Context

The platform has a durable, tenant-scoped audit trail (ADR-0040), RLS-isolated relational storage (ADR-0014/0029), and a governance evidence process, but no data catalog, lineage, data classification, PII discovery, data-subject request (DSR/GDPR) workflows, bulk import/export, periodic access reviews, or compliance evidence-pack generation. These gaps are required for enterprise compliance posture. The previous Proposed text bundled catalog + lineage + classification + PII discovery + DSR + access reviews + compliance reports into a single undifferentiated decision. Per the Phase-0 ADR decision-quality assessment (ADR-ACT-0252), this ADR must be split into per-capability sub-decisions, each with its own acceptance criteria, before any capability is implemented. This hardened version does that split.

The capabilities divide into six distinct sub-decisions with different build/compose triggers and acceptance surfaces:

1. **Data catalog + lineage** (compose-candidate: OpenMetadata / DataHub)
2. **Data classification + PII discovery** (build, reusing AIDefence-style scanning)
3. **DSR / GDPR workflows** (build, on the workflow substrate, DSR-first)
4. **Tenant data import / export** (build, MinIO sink)
5. **Access reviews** (build, on the audit trail)
6. **Compliance evidence packs / reports** (build, on the audit + evidence governance)

None of these is delivered. The ordering follows Phase 8 of the USF implementation roadmap, which requires the workflow engine (Phase 5) and backup/PITR (ADR-0064) before tenant deletion / DSR purge can be safely executed.

## Decision (Proposed sub-decisions — NOT delivered)

### Sub-decision 1: Data catalog + lineage (compose / metadata-only)

Compose **OpenMetadata** or **DataHub** (OSS, free local runner) as the data catalog. The catalog holds **metadata only** — schema shapes, lineage graphs, field classifications, and environment / tenant tags. It does not hold any row-level tenant data. The catalog **may be shared-cross-environment** only if a partitioning and leakage-proof analysis (ADR-0056) confirms no tenant runtime data can flow into it. The build-vs-compose trigger for this sub-decision is: if catalog metadata volume grows beyond what the platform's own Postgres can maintain without harming the primary OLTP workload, compose OpenMetadata or DataHub behind a `DataCatalogPort`. Until that trigger is met, a Postgres-backed built-in catalog stub is acceptable.

### Sub-decision 2: Data classification + PII discovery (build)

Build a `ClassificationPort` that scans configured tables / fields and surfaces PII classifications (personal, sensitive, financial, health) per tenant. Where AIDefence-pattern scanning is available, reuse it. Classification results are stored in the catalog (sub-decision 1) or in a dedicated Postgres classification table with RLS. No plaintext data values are stored in classification metadata.

### Sub-decision 3: DSR / GDPR workflows — DSR-first (build)

This is the highest-priority sub-decision. Build a `DsrPort` that accepts a data-subject request (`erasure`, `access`, `portability`, `rectification`) and orchestrates it as a durable workflow on the Phase-5 event substrate (ADR-0059). For `erasure`: purge personal data rows, flag the tenant record, notify the operator. For `access` / `portability`: produce a tenant-scoped export (sub-decision 4). All DSR actions are tenant-scoped, operator-initiated, and audited. DSR workflows must coordinate with legal hold (ADR-0064) — an active legal hold suspends erasure until the hold is lifted.

### Sub-decision 4: Tenant data import / export (build)

Build a `DataExportPort` and `DataImportPort` that write / read per-tenant exports to per-environment MinIO with signed, time-limited access URLs. Exports are tenant-scoped (RLS enforced at extraction), encrypted at rest in the bucket, and audited (`data.exported`, `data.imported`). Exports are a prerequisite for tenant offboarding and DSR portability responses.

### Sub-decision 5: Access reviews (build)

Build a periodic access-review workflow on the Phase-5 event substrate: enumerate active role assignments (from Keycloak realm + the platform RBAC), prompt reviewers, record approvals / revocations, and audit outcomes. Access reviews are operator-initiated on a configurable schedule.

### Sub-decision 6: Compliance evidence packs / reports (build)

Build a `ComplianceReportPort` that assembles a time-bounded evidence pack (audit events + DSR log + access-review log + backup confirmation) into a signed, downloadable report. Evidence packs reference `docs/evidence/` artefacts and are stored in MinIO. No capability here can exceed the audit trail — evidence packs summarise what the audit already records.

### Alternatives considered

1. **DSR-first build; catalog composed only when metadata volume justifies; access reviews on the audit substrate (chosen).** Prioritises the highest legal-risk gap (DSR/GDPR) first; avoids a premature catalog container; all sub-decisions are independently deployable; catalog/lineage follows demand.
2. **OpenMetadata composed unconditionally, all sub-decisions in parallel.** Rejected — premature composition before a demonstrated metadata volume need; parallel delivery requires more coordination than the dependency graph allows (DSR depends on import/export; access reviews depend on the workflow substrate).
3. **DataHub instead of OpenMetadata.** DataHub is a valid alternative (also OSS, free local). The choice between OpenMetadata and DataHub is deferred to the Phase-8 spike: both must be evaluated for metadata-only discipline, local runner resource footprint, and leakage-proof analysis. Neither is a default until the spike result is recorded as a sub-ADR.
4. **PII discovery via a standalone paid scanner.** Rejected for this pass — reusing AIDefence-style scanning is sufficient for field-level PII tagging; a paid scanner may be assessed later if field coverage proves inadequate.
5. **Shared catalog across all environments unconditionally.** Rejected — a shared catalog must pass a leakage analysis per ADR-0056 before being allowed; cross-environment catalog sharing requires proof that no tenant runtime data can flow into engineering metadata.
6. **Access reviews in Keycloak only.** Rejected — Keycloak records role assignments but the platform's own RBAC + audit trail are the authoritative record; reviews must span both.

### Rejected alternatives (required)

- **Delivering any sub-decision before an Accepted ADR governs it** — rejected: this ADR is accepted as the decision record; each sub-decision requires its own hexagonal port + adapter + proof before it is claimed delivered.
- **Sharing the catalog across environments without a leakage analysis** — rejected per ADR-0056; shared services require partitioning proof.
- **DSR erasure without coordinating with legal hold** — rejected: an active legal hold must suspend erasure.
- **Storing plaintext row data in the catalog** — rejected: the catalog holds metadata only.
- **Import/export without RLS-enforced extraction** — rejected: export scope is always tenant-scoped; a cross-tenant export is impossible by construction.
- **Compliance reports that exceed the audit trail** — rejected: evidence packs summarise the audit; they cannot assert more than what is audited.

### Accepted decision

Accept the DSR-first split: build DSR/GDPR workflows and import/export first (Phase 8); compose a data catalog only when metadata volume justifies it (build trigger recorded); build access reviews and compliance evidence packs on the existing audit substrate. Each sub-decision follows its own acceptance criteria below.

## Implementation phases

1. **Phase 8 prerequisite gates (not yet started):** workflow engine (Phase 5 — delivered), backup/PITR (ADR-0064 Phase 8 — not delivered). DSR and import/export cannot be safely proven without both.
2. **Phase 8a — Import/export foundation:** `DataExportPort` + `DataImportPort`, MinIO sink, signed URLs, RLS extraction, audit; `proof:import-export`.
3. **Phase 8b — DSR/GDPR workflows:** `DsrPort` on the event substrate; erasure + access + portability + rectification; legal-hold coordination; `proof:dsr`.
4. **Phase 8c — Classification + PII discovery:** `ClassificationPort`, field-level PII tagging, AIDefence integration; `proof:classification`.
5. **Phase 8d — Data catalog:** compose OpenMetadata or DataHub (following the Phase-8 spike); `DataCatalogPort`; leakage analysis evidence; `proof:data-catalog`.
6. **Phase 8e — Access reviews + compliance reports:** access-review workflow, `ComplianceReportPort`, signed evidence packs; `proof:access-reviews`, `proof:compliance-report`.

## Acceptance criteria

### Sub-decision 1 (catalog)

- The catalog holds metadata only (no row-level tenant data); a leakage analysis passes before any cross-environment sharing is enabled; the chosen OSS runner (OpenMetadata or DataHub) starts locally free; a `DataCatalogPort` abstraction hides the implementation.

### Sub-decision 2 (classification / PII)

- Field-level PII classifications are stored with RLS; no plaintext values in classification metadata; a classification change is audited; `proof:classification` passes against live Postgres.

### Sub-decision 3 (DSR / GDPR)

- A DSR `erasure` request purges personal data rows for the target subject, records the action in the audit trail, and is blocked by an active legal hold; a DSR `portability` request produces an export (sub-decision 4); all DSR actions are tenant-scoped; a DSR workflow survives a restart (durable, on the event substrate); `proof:dsr` passes against live Postgres + the event substrate; cross-tenant DSR is impossible.

### Sub-decision 4 (import / export)

- An export is RLS-scoped to one tenant; the export file is encrypted at rest in MinIO; the signed URL is time-limited; the export is audited; an import re-creates tenant data with the same RLS isolation; `proof:import-export` passes against live MinIO + Postgres.

### Sub-decision 5 (access reviews)

- A review run enumerates active role assignments, prompts reviewers, records approval/revocation, and audits the outcome; a review is operator-initiated on a configurable schedule; `proof:access-reviews` passes.

### Sub-decision 6 (compliance reports)

- An evidence pack is time-bounded, signed, and stored in MinIO; it includes audit events + DSR log + access-review log + backup confirmation; it does not assert more than the audit records; `proof:compliance-report` passes.

## Proof requirements

`proof:import-export` (live MinIO + Postgres — tenant-scoped extraction, encrypted object, signed URL, audit row), `proof:dsr` (live Postgres + event substrate — erasure purges, portability exports, legal-hold coordination, cross-tenant impossibility), `proof:classification` (live Postgres — field PII tags, audit, no plaintext values), `proof:data-catalog` (live catalog runner — metadata-only, leakage analysis, port abstraction), `proof:access-reviews` (live workflow substrate — enumerate, review, audit), `proof:compliance-report` (live MinIO — pack assembled, signed, stored). No registry capability may advance beyond `missing` / `partial` on the basis of a running container alone; each requires its named proof. SKIP honestly when a prerequisite (workflow engine, MinIO, PITR) is unavailable — a skipped proof is not a passed proof.

## Production blockers

- The **workflow engine** (Phase 5 Windmill/Temporal — not delivered) is a prerequisite for DSR workflows and access-review scheduling; the built-in Postgres outbox can handle simple DSR flows but is not sufficient for complex multi-step orchestration.
- **PITR / backup** (ADR-0064 Phase 8 — not delivered) is a prerequisite before tenant deletion / DSR erasure can be safely executed in production; an erasure without a confirmed backup is irreversible with no recovery path.
- **Legal hold** (ADR-0064) must be implemented and coordinated before DSR erasure is enabled; erasure must block on an active hold.
- **OpenMetadata / DataHub spike** must be completed and recorded before the catalog sub-decision is finalised; neither tool is proven for this platform's metadata-only discipline.
- **Leakage analysis** (ADR-0056) for any cross-environment catalog sharing has not been performed; shared catalog is blocked until the analysis is complete and recorded as evidence.
- No import/export, DSR, classification, access-review, or compliance-report capability exists today; all are missing from the registry.

## Consequences

Positive: the split makes each sub-decision independently implementable and provable; the DSR-first ordering addresses the highest legal-risk gap first; catalog composition is demand-driven rather than speculative; every sub-decision has a port abstraction that hides the implementation.

Negative: Phase 8 has the deepest prerequisite chain (workflow engine + backup/PITR); none of the six sub-decisions can be proven in production without those prerequisites; the data catalog choice (OpenMetadata vs DataHub) requires a spike before finalisation.

Neutral / operational: DSR workflows are operator-initiated; tenant data exports are RLS-scoped; evidence packs are signed and stored in MinIO; all actions are audited. Couples with ADR-0064 (PITR/legal-hold) and ADR-0066 (tenant deletion/export).

## Validation / evidence

Evidence level: High (compliance, privacy, GDPR). Each sub-decision requires its own named proof script against live infrastructure before the relevant capability advances in the registry. Evidence location: `docs/evidence/platform/` (per sub-decision, to be created at implementation time). No evidence document exists today; this ADR is accepted as the decision record, not as an implementation claim.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md`: ADR-ACT-0247 (original delivery tracking), ADR-ACT-0267 (this hardening). Phase-8 spike action for OpenMetadata vs DataHub evaluation to be added when Phase 8 is scheduled.

## References

ADR-0014, ADR-0029, ADR-0040, ADR-0049, ADR-0053, ADR-0054, ADR-0056, ADR-0059, ADR-0064, ADR-0066.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0267) on Matt's authority per the directive. This ADR was previously too broad (catalog + lineage + classification + PII + DSR + access reviews + compliance reports undifferentiated). This hardened version splits into six per-capability sub-decisions with individual acceptance criteria and proof requirements. No sub-decision is delivered. The previous note about requiring a split before acceptance is satisfied by this document. Ordering: DSR/import-export first (Phase 8a/b); catalog only when metadata volume justifies (Phase 8d, spike-gated).
