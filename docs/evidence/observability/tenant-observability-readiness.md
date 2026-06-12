# Tenant Observability Readiness — Evidence (ADR-0050 / ADR-ACT-0219)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

A per-tenant observability readiness layer over the existing Loki log-search plumbing
(`@platform/adapters-loki` + the `searchLogs` use case; ADR-0035):

- **Contracts** (`@platform/contracts-admin`, strict/no-passthrough):
  `TenantObservabilityReadinessResponse` (status + logIngestion + tenantScopedQuery +
  traceCorrelation + highCardinalityGuard) and `ObservabilitySignalStatus`. No log line
  or label value is ever represented.
- **Use case** (`usecases/tenant-observability.ts`): pure `assertHighCardinalityGuard`
  (derives a LogQL string from `buildLogQL` and confirms low-cardinality service/level
  are labels while tenant/trace/request/actor/organisation ids are `| json` filters),
  pure `classifyObservability`, and `getTenantObservabilityReadiness` (a bounded
  ingestion query + a bounded tenant-scoped query).
- **API**: `GET /api/org/observability/readiness`, tenant-scoped (FQDN/session); each
  Loki query is raced against a hard timeout so a slow backend cannot stall the response.
  The aggregate `GET /api/org/readiness` also carries a bounded observability signal.
- **Permissions**: new `tenant.observability.read` on `tenant-admin` (read-only — no
  write/mutation for this capability).
- **UI**: a minimal `/admin/observability` readiness panel (status + per-signal rows +
  label-guard state) + nav + `/admin/readiness` link. No dashboards, no log explorer.

## Decisions

- Tenant context is a `| json` field, never a Loki label (ADR-0029 / ADR-0035); the
  guard pins that split so a regression surfaces as `degraded`, not silent cardinality
  inflation.
- Readiness is `configured` only when ingestion is reachable AND a tenant-scoped query
  succeeds AND the guard holds; `provider_unreachable`/`degraded` classify real
  failures. Never faked.
- `traceCorrelation` is honestly `not_applicable` (traces are not wired this pass).
- No log line, label value, or tenant data is returned — only signal statuses.

## Tests run (with proof layer)

- `node:test` (platform-api) — `tenant-observability.test.ts` (across suites):
  `assertHighCardinalityGuard`, `classifyObservability` (configured / provider_unreachable
  / degraded / guard-regressed branches), `getTenantObservabilityReadiness` (configured
  when both probes succeed + traces not_applicable + tenant filter is organisationId;
  provider_unreachable when the backend throws; degraded when ingestion ok but tenant
  query fails).
- `node:test` — `capability-registry.test.ts`: `observability` is `partial`, its readiness
  reflects the new `observabilityReadiness` signal honestly, optional (non-blocking).
- Vitest (frontend) — `AdminObservabilityPage.test.tsx` (4, MSW-proven): banner + signal
  rows + guard render, degraded status renders, error state renders, axe.
- OpenAPI drift: 81 routes match `docs/api/openapi.json` (1 new path).

## Runtime proof (executed)

`apps/platform-api/scripts/tenant-observability-runtime-proof.ts`
(`npm run proof:tenant-observability`).

**Update (ADR-ACT-0224):** the readiness response now also carries honest reachability
signals for the surrounding observability infra — `metrics`, `otelCollector`,
`dashboards` (Grafana), `errorCapture` (Sentry) — each probed with a bounded GET. URLs
derive from the per-env `GRAFANA_PORT` / `OTEL_HEALTH_PORT`. A service that is not wired
is `not_configured`; one with no local backend is `not_applicable` — never `ok`. These
signals are informational: they are surfaced but do NOT downgrade the core status (driven
by logs + the label guard).

Executed output (dev profile; Loki @ `:3100`, Grafana @ `:3200`, OTel health @ `:13133`;
no Prometheus, no Sentry DSN; 2026-06-12):

```text
# Tenant observability runtime proof

PASS  high-cardinality guard holds (service/level labels; ids | json)
PASS  ingestion+tenant ok + guard → configured
PASS  ingestion unreachable → provider_unreachable
PASS  live Loki probe reachable @ http://localhost:3100 — status=configured ingestion=ok tenantQuery=ok
PASS  trace correlation honestly not_applicable
INFO  infra signals: dashboards=ok otel=ok metrics=not_applicable errorCapture=not_configured
PASS  Grafana dashboards reachable (or honestly not_configured)
PASS  OTel collector reachable (or honestly not_configured)
PASS  metrics honestly not_applicable/not_configured (no local Prometheus)
PASS  error-capture honestly not_configured/ok (Sentry DSN-gated)

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- **Live-proven (against the local stack):** bounded Loki ingestion + tenant-scoped query
  (`configured`); **Grafana** dashboards reachability (`ok` @ :3200); **OTel collector**
  health reachability (`ok` @ :13133).
- **Honestly classified as NOT ready (live):** `metrics` → `not_applicable` (no local
  Prometheus); `errorCapture` → `not_configured` (no Sentry DSN). Never reported `ok`.
- Unit-proven (`node:test`): the label-hygiene guard, the classifier (all branches), probe
  success/failure/degraded semantics, and that infra signals are surfaced without
  downgrading the core status.
- MSW-proven (frontend): the `/admin/observability` panel renders all signal rows + axe.
- NOT proven (honestly deferred): trace/log correlation (`not_applicable` — no trace
  backend like Tempo locally) and a real metrics backend.

## Capability map changes

`observability`: stays **partial** — logs readiness + Grafana/OTel reachability are
live-proven, but traces and metrics have no local backend (`not_applicable`), so the
capability is honestly not yet fully `implemented`. Gains the extra infra signals in the
readiness response; `readinessKind: "tenant-observability"`; the aggregate
`observabilityReadiness` signal (logs-driven) is unchanged.

## Known deferrals

- Trace/log correlation readiness — needs a trace backend (e.g. Tempo); `not_applicable`.
- A real metrics backend (e.g. Prometheus) — `not_applicable` until `PROMETHEUS_URL` set.
- Live Sentry error-capture — `not_configured` until a `SENTRY_DSN` is wired + reachable.

## No-leak guarantee

The readiness surface returns only signal statuses + a boolean guard flag — no log line,
label value, or tenant data. Queries are tenant-scoped (organisationId `| json` filter);
no cross-tenant access.

## No-fake-readiness guarantee

`configured` requires a real reachable ingestion query AND a tenant-scoped query AND an
intact label guard. Asserted by `tenant-observability.test.ts` and
`capability-registry.test.ts`.

## ACTION-REGISTER linkage

ADR-ACT-0219 (Source ADR-0050). Evidence: this file.
