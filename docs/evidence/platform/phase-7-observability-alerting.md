# Phase 7 — observability, alerting, and incident foundation (delivery evidence)

- **Action:** ADR-ACT-0261 — governing ADR: ADR-0062 (observability/alerting/incident, **Accepted** for the built-in foundation; composed metrics/trace + alerting backends, on-call/escalation, and the public status page remain **Proposed** Phase-7.5 sub-decisions).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 7 is the built-in observability foundation only; no metrics/trace backend, composed alerting, on-call, or status page is delivered.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS) — proofs run repos as the non-superuser `platform_app` role, create + clean up their own test orgs, and SKIP honestly (exit 0) if Postgres is unavailable:

- `proof:observability-signals` — a signal is registered + queryable with its latest sample; **RLS** isolates signals + samples per tenant; no secret-bearing columns.
- `proof:alerting` — `no_data` before samples; **within threshold does not fire**; **above threshold fires + opens an incident**; **RLS** isolates rules; no secret columns.
- `proof:incident-foundation` — a fired alert opens an incident; lifecycle **open → acknowledged → resolved**; the lifecycle is **audited** (real Postgres audit port: ≥3 `incident.opened`/`incident.updated` rows); **RLS** isolation; no secret columns.
- `proof:alert-notification-bridge` — a fired alert dispatches through the **Phase-6 notification substrate**: an **enabled channel is sent**, a **disabled channel is suppressed**; the dispatch is logged; the alert payload carries **no secret fields**.

In-memory `node:test` suite (`observability-alerting`, 5 cases) covers signal/sample/readiness, within/fired evaluation + incident open, no_data, the preference-gated bridge, and the audited lifecycle.

## Delivered

1. **Metric signal registry + samples** — `metric_signals` + `metric_samples` (migration 029, RLS): register a signal (server-internal), append samples, query the latest value.
2. **Alert rules + evaluation** — `alert_rules` (RLS): operator threshold rules (signal + comparator gt/gte/lt/lte + threshold + severity + notification target). `evaluateAlert` → within / fired / no_data / disabled.
3. **Incident lifecycle** — `incidents` (RLS): a fired alert opens an incident; operators transition open → acknowledged → resolved; every open + transition audited.
4. **Alert → notification bridge** — a fired alert dispatches to the rule's `notifyUserId` via the Phase-6 substrate (preference-gated; a disabled channel suppresses; no secret payload).
5. **Ports + adapter** — `MetricRepository` + `AlertRepository` + `IncidentRepository` (DDD-split) + `PostgresObservabilityRepository` (tenant reads via `withTenant`; operator/cross-tenant + sample recording via `withSystemAdmin`).
6. **Routes** (+ OpenAPI): `GET /api/admin/observability/signals`, `GET/POST /api/admin/alerts`, `POST /api/admin/alerts/:alertId/evaluate`, `GET /api/admin/incidents`, `PATCH /api/admin/incidents/:incidentId`, `GET /api/admin/observability/readiness` (operator-only).
7. **Permissions** — `platform.observability.read|write` (operator-only) in `domain-identity`.
8. **UI** — `/admin/monitoring`: readiness card + per-tenant signals/alerts/incidents, alert create + evaluate, incident acknowledge/resolve. Operator-only; React renders BFF state only.
9. **Contracts** — signal/alert/incident/readiness schemas in `@platform/contracts-admin`; `alert_rule` + `incident` audit resources; `alert.rule_set` + `incident.opened` + `incident.updated` actions.

## Enforced invariants (proven)

Signals/rules/incidents tenant-isolated (RLS); within does not fire, above fires + opens an incident; incident lifecycle audited; a fired alert dispatches through the preference-gated notification substrate (disabled suppresses); no secret fields in alert payloads or any column; operator routes global-scoped; readiness never faked; server-authoritative.

## Still NOT delivered (explicitly)

- **Composed metrics/trace backend** (Prometheus / Tempo) — Phase 7.5, behind `MetricRepository`. The built-in signal/sample store is not a substitute at volume.
- **Composed alerting** (Alertmanager / Grafana Alerting) — Phase 7.5, behind `AlertRepository`.
- **On-call / escalation policies + public status page** — Phase 7.5+.
- **OTEL sample producers** — ingestion is server-internal (`recordSample`); wiring real producers / an OTEL bridge is incremental.

## Governance

- ADR-0062 **split + hardened + Accepted** (Phase-7 built-in foundation) on Matt's authority; composed backends + on-call + status page kept Proposed. CODEMAPS updated (ADR-0062 → Accepted).
- Registry: new **`observability-alerting-builtin`** → **locally proven**; `metrics-traces` + `alerting-incident-oncall` remain **partial** (composed backend + on-call/status-page deferred). `delivery` gains the new row + a `phase-7` gate (requires ADR-0062). Validator + matrix re-rendered (56 capabilities).

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, all prior proofs, `proof:observability-signals` (live), `proof:alerting` (live), `proof:incident-foundation` (live), `proof:alert-notification-bridge` (live), `audit:osv`, `audit:deps`, `make check`.
