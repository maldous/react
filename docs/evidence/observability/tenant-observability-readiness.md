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

Executed output (local Loki @ `http://localhost:3100`, dev profile, 2026-06-12):

```text
# Tenant observability runtime proof

PASS  high-cardinality guard holds (service/level labels; ids | json)
PASS  ingestion+tenant ok + guard → configured
PASS  ingestion unreachable → provider_unreachable
PASS  live Loki probe reachable @ http://localhost:3100 — status=configured ingestion=ok tenantQuery=ok
PASS  trace correlation honestly not_applicable

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (against Loki): bounded ingestion + tenant-scoped query reachability →
  `configured`.
- Unit-proven (`node:test`): the label-hygiene guard, the classifier (all branches), and
  the probe success/failure/degraded semantics via a fake port.
- MSW-proven (frontend): the `/admin/observability` panel render/degraded/error + axe.
- NOT proven (honestly deferred): trace/log correlation (`not_applicable`), metrics
  readiness, and dashboard link metadata.

## Capability map changes

`observability`: stays **partial** (logs readiness implemented; traces/dashboards/metrics
deferred) but gains `readinessKind: "tenant-observability"`, `adminRoute:
/admin/observability`, `requiredPermission: tenant.observability.read`, and a new bounded
`observabilityReadiness` signal in `/api/org/readiness`. Optional → never blocks overall.

## Known deferrals

- Trace/log correlation readiness (`traceCorrelation` is `not_applicable`).
- Metrics readiness and per-tenant dashboard link metadata.

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
