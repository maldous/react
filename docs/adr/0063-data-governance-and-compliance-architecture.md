# ADR-0063: Data governance and compliance architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / data / security

## Consulted

Data; security; legal/compliance stakeholder; AI assistant (drafting, human review required).

## Context

There is durable, tenant-scoped audit (ADR-0040) and an evidence-governance process, but no data catalog, lineage, classification, PII discovery, DSR/GDPR workflows, data export/import, access reviews, or compliance report generation. These are required for an enterprise provider substrate.

## Decision

1. **Data catalog + lineage (compose):** OpenMetadata or DataHub (OSS). The catalog holds **metadata only** and may be shared-cross-environment with env/tenant tagging and a leakage analysis (ADR-0056).
2. **Classification + PII discovery (build/compose):** classify tenant data and surface PII; reuse AIDefence-style scanning where available.
3. **DSR/GDPR + import/export (build):** tenant-scoped data-subject request and portability workflows on the workflow substrate (ADR-0059), writing exports to per-environment MinIO with signed access.
4. **Access reviews + compliance reports (build):** periodic role/access reviews and evidence-pack generation built on the audit trail.

## Consequences

Positive: enterprise compliance posture; reuses audit + storage + workflow substrates.

Negative: large scope; catalog-sharing requires strict metadata-only discipline; DSR must be per-tenant.

Neutral / operational: couples with backup/retention/legal-hold (ADR-0064) and tenant deletion (ADR-0066).

## Validation / evidence

Evidence level: High (compliance + privacy risk). New DSR and isolation proofs required.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0247).

## References

ADR-0014, ADR-0040, ADR-0053, ADR-0059, ADR-0064.

## Notes

Remains **Proposed** (NOT accepted in ADR-ACT-0254): too broad — it bundles catalog + lineage + classification + PII discovery + DSR + access reviews + compliance reports. It must be **split** (DSR-first) and hardened before acceptance.
