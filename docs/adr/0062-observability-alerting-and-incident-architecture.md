# ADR-0062: Observability, alerting, and incident architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / operations

## Consulted

Operations; engineering; AI assistant (drafting, human review required).

## Context

Logs are delivered and proven (Loki + Alloy + Grafana; ADR-0035, ADR-0050). The OTEL collector ingests metrics/traces but there is **no** metrics/trace backend, no alert rules, no notification channels, no SLOs, no incident lifecycle, no on-call/escalation, and no public status page. The internal service catalog + readiness (ADR-ACT-0228) is delivered but readiness is not alerting. Grafana running is not incident management.

## Decision

1. **Metrics + traces (compose):** Prometheus + Tempo (OSS) behind the existing OTEL collector seam; per-environment, env/tenant labelled.
2. **Alerting (compose):** Grafana Alerting + Alertmanager (OSS) with defined notification channels and SLOs.
3. **Incident management (build/compose):** incident lifecycle, on-call/escalation, runbooks, and a public status page driven by the existing readiness API.
4. Alerting/incident tooling may be **shared-cross-environment** only with env labels, access control, and a leakage analysis (ADR-0056).

## Consequences

Positive: closes the metrics/trace/alert/incident gap on a proven log foundation.

Negative: multiple new components; shared alerting needs careful isolation.

Neutral / operational: status page reuses readiness data already exposed.

## Validation / evidence

Evidence level: Medium–High. Existing: `proof:platform-services`, `proof:tenant-observability`. New alerting/incident proofs required.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0246).

## References

ADR-0020, ADR-0035, ADR-0050, ADR-0053, ADR-ACT-0228.

## Notes

Proposed; acceptance requires human review.
