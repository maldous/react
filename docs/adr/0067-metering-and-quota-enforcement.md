# ADR-0067: Metering and quota enforcement architecture

## Status

Accepted (2026-06-13, ADR-ACT-0256 — Phase 2; accepted on Matt's authority per the Quad directive)

## Date

2026-06-13

## Decision owner

Architecture owner / product owner

## Consulted

Product; finance/billing stakeholder (boundary only); engineering; security; AI assistant (drafting + option comparison, human review required).

## Context

ADR-0057 originally bundled entitlements + metering + quotas + billing + payment, which is too broad to be decision-quality. Phase 1 (ADR-0058/ADR-ACT-0254/0255) delivered the entitlement engine with a **no-op quota hook**. Phase 2 must turn that hook into **real quota enforcement** backed by **local-first usage metering**, without delivering billing/invoicing/payment (those stay in ADR-0057, Phase 9). This ADR is the metering + quota decision; ADR-0061 holds the metering-vs-analytics boundary.

## The four concepts (authoritative)

- **Entitlements** answer: _is this tenant allowed to use the capability?_ (ADR-0058; tenant-scoped grant.)
- **Metering** answers: _how much usage was recorded?_ (append-safe, idempotent usage events.)
- **Quota** answers: _is the next action allowed under the tenant's entitlement/limit?_ (entitlement → usage-vs-limit decision.)
- **Billing** answers: _what should be charged?_ — **NOT delivered in Phase 2** (ADR-0057, Phase 9).

## Decision

1. **Metering (build, local-first):** a `MeteringRepository` port with a built-in **Postgres** adapter (`meter_events`, migration 024): tenant-scoped, RLS-isolated, **idempotent by (tenant, meter_key, idempotency_key)**, append-safe, windowed aggregation (daily / monthly / rolling_30d / lifetime). Recording a metered event requires the meter's capability entitlement (deny-by-default). Negative quantity is rejected unless an explicit adjustment.
2. **Quota (build):** a `QuotaRepository` port + Postgres adapter (`tenant_quotas`) holding per-tenant quota definitions (entitlement key + meter key + limit + window + action). `evaluateQuota` decides allow/deny **after** the pipeline's permission step and **after** the entitlement check: not entitled → denied at the entitlement step; else usage-over-limit (action `deny`) → denied at the quota step. Denials throw a typed `platform-errors` error and are loggable. No configured quota ⇒ allowed (opt-in).
3. **Server-authoritative:** all metering writes and quota decisions are server-side. React only renders the state the BFF returns; it never decides quota.
4. **Ingestion is operator/internal:** meter events are emitted server-internally (in-process) or via an operator route (`POST /api/admin/tenants/:tenantId/meter-events`, `platform.metering.write`). Tenant self-ingestion of billable/limited usage is deliberately **not** exposed (integrity).
5. **Provider path:** the built-in Postgres metering is delivered now. **ClickHouse / OpenMeter providerisation is Phase 2.5**, added behind the same `MeteringRepository` port — not in this pass (the existing `adapters-clickhouse` is analytics-only with no synchronous uniqueness, which the hard idempotency invariant requires).

### Alternatives considered

1. **Built-in Postgres metering + quota now; ClickHouse/OpenMeter later (chosen).** RLS isolation + unique-constraint idempotency reuse the proven Phase-1 pattern; fully live-provable; honest about the provider follow-up.
2. **ClickHouse meter store now.** Preferred long-term for volume, but ClickHouse lacks synchronous uniqueness (idempotency would be eventual via ReplacingMergeTree) and has no DDL/migration mechanism in-repo — too heavy for a clean, idempotent first pass.
3. **OpenMeter composed now.** A container is not a capability; adds operational weight before a proven need. Deferred to Phase 2.5 behind the port.
4. **Redis counters as the durable meter store.** Fast but not durable/auditable as the system of record.

### Rejected alternatives (required)

- **Billing-before-metering** — rejected: you cannot bill what you cannot measure; metering + quota come first, billing is Phase 9.
- **UI-only quota warnings** — rejected: enforcement is server-side; the UI only renders BFF state.
- **Quota decisions in React** — rejected: client-side quota is not authoritative and is trivially bypassed.
- **Quota enforcement without an audit/log signal** — rejected: quota changes are audited (audit-before-change); denials are loggable.
- **A paid SaaS metering dependency for local proof** — rejected: violates free-local-first (ADR-0053); local proof uses Postgres only.
- **Using Sentry or Loki as the usage-metering warehouse** — rejected: Sentry is errors-only and Loki is logs; neither is the usage warehouse (the metering store is per-environment Postgres now, ClickHouse later).

### Accepted decision

Adopt option 1. Built-in Postgres metering + quota, server-authoritative, operator-ingested, entitlement-then-quota ordering, audited quota changes, ClickHouse/OpenMeter as a Phase-2.5 provider behind the port. Billing is out of scope.

## Implementation phases

1. **Metering substrate (Phase 2, done):** migration 024, `MeteringRepository` port + Postgres adapter, `metering` usecase (validate + entitlement gate + idempotent record + windowed aggregate).
2. **Quota enforcement (Phase 2, done):** `QuotaRepository` port + Postgres adapter, `quota` usecase (`evaluateQuota` / `assertQuota` / `listQuotas` / `setQuota` audited), replacing the Phase-1 hook.
3. **Surfaces (Phase 2, done):** BFF routes + `/admin/usage` UI (operator quota console + tenant read-only).
4. **Provider (Phase 2.5, future):** ClickHouse/OpenMeter adapter behind `MeteringRepository`; service-catalog provider entry + readiness + classification.

## Acceptance criteria

- Meter events are tenant-scoped, RLS-isolated, idempotent by (tenant, meter, idempotency key), append-safe; invalid meter keys + negative non-adjustment quantities rejected.
- Recording requires the meter's entitlement; quota denies when usage exceeds the limit; entitlement is checked before quota; denials are typed + loggable; quota changes audited.
- No quota decision in React; no secret fields in usage/quota responses; no paid provider in local proof.
- `proof:metering`, `proof:quota-enforcement`, `proof:metering-quota-routes` pass against live Postgres (SKIP honestly if unavailable).

## Proof requirements

`proof:metering`, `proof:quota-enforcement`, `proof:metering-quota-routes` (live Postgres). In-memory node:test suites (`metering`, `quota`) for logic. No registry status upgrade from a skipped proof.

## Production blockers

- High-volume production metering should move to ClickHouse/OpenMeter (Phase 2.5) behind the port before heavy load.
- Billing/invoicing/payment (ADR-0057) is required before any charging — not delivered.

## Consequences

Positive: real quota enforcement, local-first, fully live-proven, honest provider path; clean separation of the four concepts.

Negative: Postgres metering is not ideal for very high event volume (mitigated by the Phase-2.5 provider path).

Neutral / operational: meter events are append-safe data (not individually audited); quota definitions + changes are audited.

## Validation / evidence

Evidence level: High (tenant-isolation + enforcement risk). Local proof via the three Phase-2 proofs + node:test suites. Evidence: `docs/evidence/platform/phase-2-metering-quota.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0256; ADR-ACT-0245 metering discovery; ADR-ACT-0241 billing remains Phase 9).

## References

ADR-0053, ADR-0057 (billing, re-scoped), ADR-0058, ADR-0061; `docs/evidence/platform/universal-service-foundation-implementation-roadmap.md`.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0256) on Matt's authority per the Quad directive. Billing/payment is explicitly NOT accepted or delivered here.
