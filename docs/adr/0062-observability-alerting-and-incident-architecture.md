# ADR-0062: Observability, alerting, and incident architecture

## Status

Accepted (2026-06-13, ADR-ACT-0261 — Phase 7 built-in foundation; accepted on Matt's authority per the directive). The **composed metrics/trace backend** (Prometheus/Tempo), **composed alerting** (Alertmanager/Grafana Alerting), **on-call/escalation**, and a **public status page** remain **Proposed** Phase-7.5 provider sub-decisions (NOT delivered here).

## Date

2026-06-13

## Decision owner

Architecture owner / operations

## Consulted

Operations; engineering; AI assistant (drafting, human review required).

## Context

Logs are delivered and proven (Loki + Alloy + Grafana; ADR-0035, ADR-0050). The OTEL collector ingests metrics/traces but there was **no** metrics-backed signal store, no alert rules, no alert evaluation, no incident lifecycle, and no notification path from alerts. The internal readiness API (ADR-ACT-0228) is delivered but readiness is not alerting; Grafana running is not incident management; Sentry is error capture, not incidents. This ADR was too broad (metrics + traces + alerting + incident + on-call + status page) and is **split** here: Phase 7 delivers the **built-in foundation**; the composed backends + on-call + status page are a later provider phase.

## Decision (Phase 7 — accepted, built-in foundation)

1. **Metric signal registry + samples (build):** `metric_signals` + `metric_samples` (migration 029), tenant-scoped (RLS). A signal is registered (server-internal) and observed values appended; the latest value is queryable. This is the built-in metrics foundation — **not** a Prometheus/Tempo backend.
2. **Alert rules + evaluation (build):** `alert_rules` (RLS) — operator-managed threshold rules (signal + comparator + threshold + severity + notification target). `evaluateAlert` compares the signal's latest sample to the threshold: within ⇒ no-op; above ⇒ **fires**. Audited.
3. **Incident lifecycle (build):** `incidents` (RLS). A fired alert **opens an incident**; operators transition open → acknowledged → resolved. Every open + transition is **audited** (incident.opened / incident.updated).
4. **Alert → notification bridge (build):** a fired alert dispatches a notification to the rule's target user through the **Phase-6 notification substrate** (ADR-0068) — the user's preferences gate it (a **disabled channel suppresses**). No secret fields in alert payloads.
5. **Server-authoritative + operator-only:** signals/alerts/incidents routes are operator-scoped (`platform.observability.read/write`, global); readiness never fakes provider health.

## Decision (Proposed sub-decisions — NOT delivered)

1. **Composed metrics/trace backend (Phase 7.5, compose):** Prometheus + Tempo behind the OTEL collector seam, behind the same `MetricRepository` — when real backend retention/query is needed.
2. **Composed alerting (Phase 7.5, compose):** Grafana Alerting / Alertmanager with notification channels + SLOs, behind the `AlertRepository`.
3. **On-call / escalation + public status page (Phase 7.5+, build/compose):** escalation policies, runbooks, and a status page driven by the readiness API.
4. Composed alerting/incident tooling may be **shared-cross-environment** only with env labels + access control + a leakage analysis (ADR-0056).

### Alternatives considered

1. **Built-in foundation now; composed backends later behind the ports (chosen).** Reuses RLS + audit + the Phase-6 notification substrate; fully live-provable; honest about the provider follow-up.
2. **Compose Prometheus/Alertmanager now.** Real backend, but heavy + before a proven need; deferred to Phase 7.5 behind the ports.
3. **Treat readiness as alerting.** Rejected — readiness is point-in-time, not threshold evaluation + incident lifecycle.

### Rejected alternatives (required)

- **A static dashboard equals observability** — rejected: signals + alert evaluation + incidents are distinct from a dashboard.
- **Loki logs equal metrics** — rejected: logs (ADR-0035) are not the metric signal store.
- **Sentry errors equal incidents** — rejected: Sentry is error capture; incidents have a lifecycle + audit trail here.
- **UI-only alert rules** — rejected: rules + evaluation are server-side; React renders state.
- **Alerts without a notification path** — rejected: a fired alert dispatches through the Phase-6 substrate.
- **Incidents without an audit trail** — rejected: open + every transition are audited.
- **Claiming Prometheus/Alertmanager without live proof** — rejected: only the built-in foundation is delivered + proven; composed backends stay Proposed.

### Accepted decision

Adopt option 1 for Phase 7: a built-in metric-signal registry, threshold alert rules + evaluation, an incident lifecycle, and an alert→notification bridge — all tenant-isolated, audited, server-authoritative. Composed backends + on-call + status page are Phase-7.5 providers behind the same ports.

## Implementation phases

1. **Substrate (Phase 7, done):** migration 029, `MetricRepository`/`AlertRepository`/`IncidentRepository` ports + Postgres adapter, `observability` usecase (registerSignal/recordSample/listSignals; setAlertRule/evaluateAlert; incident lifecycle; readiness).
2. **Surfaces (Phase 7, done):** operator routes (signals, alerts + evaluate, incidents + transition, readiness) (+ OpenAPI); `/admin/monitoring` UI.
3. **Providers (Phase 7.5, future):** Prometheus/Tempo + Alertmanager + on-call/status page behind the ports.

## Acceptance criteria

- A signal is registered + queryable; an alert evaluates within (no fire) and above (fires → opens an incident); the incident lifecycle is audited; a fired alert dispatches through the notification substrate (disabled channel suppresses); no secret fields in alert payloads; operator routes are global-scoped; readiness reports degraded/blocked honestly; everything tenant-isolated (RLS).
- `proof:observability-signals`, `proof:alerting`, `proof:incident-foundation`, `proof:alert-notification-bridge` pass against live Postgres (SKIP honestly if unavailable).

## Proof requirements

The four Phase-7 proofs above (live Postgres) + an in-memory `node:test` suite. No registry status upgrade from a skipped proof.

## Production blockers

- High-volume metrics/traces + retention need the composed backend (Phase 7.5).
- On-call/escalation + public status page are not delivered.
- Sample ingestion is server-internal; wiring real producers/OTEL bridge is incremental.

## Consequences

Positive: closes the alert/incident gap on a proven log + notification foundation; fully live-proven; tenant-isolated + audited.

Negative: the built-in metric store is not a substitute for a real metrics/trace backend at volume (mitigated by the Phase-7.5 provider path).

Neutral / operational: incident audit trail + notification bridge reuse existing substrates.

## Validation / evidence

Evidence level: Medium–High. Local proof via the four Phase-7 proofs + the `observability-alerting` node:test suite. Evidence: `docs/evidence/platform/phase-7-observability-alerting.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0261; ADR-ACT-0246 observability discovery).

## References

ADR-0020, ADR-0035, ADR-0050, ADR-0053, ADR-0056, ADR-0068, ADR-ACT-0228.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0261) on Matt's authority per the directive. Composed metrics/trace + alerting backends, on-call/escalation, and the public status page are explicitly NOT delivered here — Phase 7.5, behind the same ports.
