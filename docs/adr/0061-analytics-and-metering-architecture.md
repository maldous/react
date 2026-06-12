# ADR-0061: Analytics and metering architecture

## Status

Proposed

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

Proposed; acceptance requires human review.
