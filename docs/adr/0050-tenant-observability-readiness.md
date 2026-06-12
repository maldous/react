# ADR-0050: Tenant Observability Readiness

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0020 (observability/diagnostics primitives), ADR-0029 (multi-tenant isolation —
tenant context never a high-cardinality label), ADR-0035 (enterprise log indexing +
search), ADR-0045 (capability map), ADR-0048/0049 (sibling readiness slices). Reuses
the existing Loki log-search plumbing (`@platform/adapters-loki` `buildLogQL` /
`LokiLogQueryAdapter` + the `searchLogs` use case). Claude Opus 4.8 (implementation
assistance, human-reviewed).

## Context

The ADR-0045 capability map listed `observability` as **partial** with no live
readiness check, even though tenant log search already exists (ADR-0035:
`/admin/logs`, `buildLogQL`, `LokiLogQueryAdapter`, with low-cardinality
`service`/`level` as Loki labels and high-cardinality ids — `tenantId`, `traceId`,
`requestId`, `actorId`, `organisationId` — as `| json` field filters). What was
missing was a per-tenant readiness signal: is log ingestion reachable, does a
tenant-scoped query work, and is the high-cardinality-label hygiene intact?

Constraints and risks:

- No log line, label value, or tenant data may be returned by the readiness surface.
- No cross-tenant log access.
- Readiness must be honest (ADR-0045): backed by a live check, never faked.
- The label model must not regress: high-cardinality ids must never become labels.
- The probe must be bounded so a slow/unreachable backend cannot stall the response.

## Stakeholder concerns

- Operations: a tenant admin (and `/admin/readiness`) can see whether logging is
  reachable and tenant-scoped queries work.
- Security/Data: tenant context is a `| json` field, never a label; no log content
  leaves the BFF; no cross-tenant access.
- Cost: high-cardinality labels are a known Loki cost/cardinality risk — the guard
  pins the existing split so it cannot regress.

## Decision drivers

- Honesty over breadth (no dashboard product).
- Reuse of the proven Loki adapter + LogQL builder.
- A bounded, repeatable live probe + a structural label-hygiene guard.

## Options considered

### Option A: Bounded tenant-scoped log probe + structural label guard (chosen)

Add `getTenantObservabilityReadiness` (a bounded ingestion query + a bounded
tenant-scoped query via the existing port, plus `assertHighCardinalityGuard` that
derives a LogQL string and confirms the label/field split) and
`GET /api/org/observability/readiness`. A minimal `/admin/observability` panel surfaces
the signals. Capability stays **partial** (logs readiness implemented; traces +
dashboards + metrics deferred), now with a real readiness signal.

Pros: reuses proven plumbing; honest; bounded; cheap. Cons: a live probe does a bounded
HTTP query (timeout-guarded).

### Option B: Full observability product (dashboards, trace explorer, metrics)

Pros: rich. Cons: far out of scope for a readiness pass; rejected.

### Option C: Promote with a structural-only check (no probe)

Pros: trivial. Cons: cannot honestly claim "reachable"; rejected.

## Decision

Adopt **Option A**. Readiness statuses: `configured` (ingestion reachable AND
tenant-scoped query ok AND the label guard holds), `provider_unreachable` (ingestion
query failed), `degraded` (reachable but the tenant query failed, or the guard
regressed), `not_configured` (reserved — no backend wired), `unknown`. Per-signal
statuses (`logIngestion`, `tenantScopedQuery`, `traceCorrelation`,
`highCardinalityGuard`) are reported; `traceCorrelation` is honestly `not_applicable`
(traces are not wired this pass). `GET /api/org/observability/readiness` is gated by a
new `tenant.observability.read` permission; tenant authority + the tenant filter derive
from FQDN/session. Every Loki query is raced against a hard timeout so the readiness
response cannot stall. The capability map keeps `observability` **partial** but with a
live `tenant-observability` readiness signal in `GET /api/org/readiness` (bounded probe,
optional → non-blocking).

## Rationale

The high-cardinality-label split is the established cost/correctness control
(ADR-0029 / ADR-0035); asserting it structurally from `buildLogQL` means a regression
surfaces as `degraded` rather than silently inflating Loki cardinality. The probe is
bounded and read-only, returns only signal statuses, and never exposes log content.

## Consequences

Positive: honest, bounded observability readiness; label hygiene guarded against
regression; no log-content egress. Negative: the readiness endpoint performs bounded
Loki queries. Neutral: a `proof:tenant-observability` script proves the guard, the
classifier, and a LIVE Loki probe against the local backend.

## AI-assistance record

AI used: Yes. Tool/model: Claude Opus 4.8 (1M context), Claude Code. Scope:
implementation, tests, runtime proof, this ADR. Human review: required before merge.

## Validation / evidence

Evidence level: High. Evidence: `docs/evidence/observability/tenant-observability-readiness.md`.

## Impacted areas

- Architecture: new readiness use case + `/api/org/observability/readiness` route;
  reuses the Loki adapter + `buildLogQL`.
- Data: no schema change; bounded read-only Loki queries.
- API: `GET /api/org/observability/readiness`.
- Security: tenant context as a `| json` field (never a label); no log-content egress;
  no cross-tenant access.
- Testing: backend unit (guard + classifier + probe) + frontend MSW/axe + OpenAPI drift
  - a live Loki runtime proof.
- UX: minimal `/admin/observability` readiness panel + nav + readiness link.
- Documentation: capability map, OpenAPI, i18n, CODEMAPS, ACTION-REGISTER.

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0219 covers this slice. Future actions: trace/log correlation readiness,
metrics readiness, and per-tenant dashboard link metadata.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0020 observability/diagnostics primitives
- ADR-0029 multi-tenant isolation (no high-cardinality tenant labels)
- ADR-0035 enterprise log indexing and search
- ADR-0045 enterprise capability map
- ADR-0049 tenant storage readiness (sibling readiness slice)

## Notes

Readiness statuses: `configured`, `not_configured`, `provider_unreachable`,
`degraded`, `unknown`. Signal statuses: `ok`, `unreachable`, `not_applicable`,
`unknown`. The high-cardinality-label guard keeps `service`/`level` as Loki labels and
`tenant/trace/request/actor/organisation` ids as `| json` filters; a regression →
`degraded`. No log content is ever returned.
