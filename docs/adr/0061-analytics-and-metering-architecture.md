# ADR-0061: Analytics and metering architecture

## Status

Accepted (2026-06-13, ADR-ACT-0256 — analytics/metering boundary hardened for Phase 2; accepted on Matt's authority per the Quad directive)

## Date

2026-06-13

## Decision owner

Architecture owner / data

## Consulted

Data; product; engineering; AI assistant (drafting, human review required).

## Context

ClickHouse is composed per-environment for analytics (ADR-0015) but there is no product-analytics pipeline and no usage-metering pipeline. Sentry's internal ClickHouse is shared-with-Sentry-only and must not be conflated with the platform analytics warehouse. Metering underpins billing (ADR-0057).

## Decision

1. **Metering (compose):** OpenMeter (OSS) on the already-composed per-environment ClickHouse; meter events are tenant-tagged and partitioned by tenant.
2. **Product analytics (build on compose):** model analytical event ingestion on the existing ClickHouse with tenant partitioning; expose tenant-scoped query APIs via the BFF (never direct ClickHouse access from React).
3. Per-environment; ClickHouse remains environment-specific.
4. The platform analytics warehouse is distinct from Sentry's ClickHouse.
5. **Metering vs analytics boundary (the hardened decision):** _metering_ (usage for quota/billing) is the **system of record** and is delivered built-in on per-environment **Postgres** now (ADR-0067), with ClickHouse/OpenMeter as a later (Phase 2.5) provider behind the `MeteringRepository` port; _product analytics_ (high-volume behavioural events for dashboards) is a **separate, still-future** capability on ClickHouse. They are not the same store and must not be conflated; neither is Sentry's ClickHouse.

### Alternatives considered

1. **Postgres metering now (system of record) + ClickHouse for analytics later; both per-environment, distinct from Sentry (chosen).**
2. **One ClickHouse store for both metering and analytics now.** Couples a billing-critical system of record to an analytics engine lacking synchronous idempotency; deferred (ADR-0067 option 2).
3. **Reuse Sentry's ClickHouse.** Rejected — Sentry is errors-only and shared-with-Sentry.

### Rejected alternatives

- Sentry/Loki as the usage warehouse — rejected (see ADR-0067).
- Direct ClickHouse access from React — rejected; all analytical reads go through the BFF.

### Acceptance criteria

- Metering is the per-environment system of record (Postgres now), tenant-isolated; analytics is a separate future ClickHouse capability; neither uses Sentry's ClickHouse.
- Any analytics query is BFF-mediated and tenant-scoped; no direct ClickHouse from React.

### Proof requirements

`proof:metering` (tenant-isolated ingestion + aggregation) — delivered in Phase 2. Product-analytics proofs are future.

### Production blockers

- Product analytics is not delivered; do not claim it. High-volume metering should move to the ClickHouse/OpenMeter provider (Phase 2.5) before heavy load.

## Consequences

Positive: reuses existing infrastructure; metering and analytics share one store; clean billing integration.

Negative: high-cardinality tenant partitioning must be managed; retention policies required.

Neutral / operational: feeds billing meters and product dashboards.

## Validation / evidence

Evidence level: Medium–High. New `proof:metering` (tenant-tagged ingestion + aggregation) required.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0245).

## References

ADR-0015, ADR-0053, ADR-0057.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0256) on Matt's authority per the Quad directive — the metering/analytics boundary is hardened for Phase 2. Product analytics remains a future capability (not delivered); billing (ADR-0057) is Phase 9.
