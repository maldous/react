# Composed provider readiness (search / observability)

**ADR:** ADR-0071 · **Action:** ADR-ACT-0271 · **Status:** Delivered + locally proven
**Capability:** `composed-provider-readiness` (foundation-cross-cutting)

## Scope delivered

A capability-agnostic readiness spine for composed providers, feeding the
provider-config adapter-confirmed lifecycle (ADR-0070):

- **`ProviderReadinessProbe` port + generic `HttpProviderReadinessProbe` adapter** —
  GETs a provider's health endpoint with the global `fetch` (no new dependency) and
  classifies honestly: `not_configured` (no endpoint), `ready` (health 2xx + optional
  body predicate), `degraded` (wired but unreachable). Auth headers (e.g. Meilisearch
  master key) are sent but **never echoed** into the result.
- **`composed-providers` usecase + `GET /api/admin/providers/readiness`** (operator-only
  `platform.providers.read`) — probes every composed provider live and maps each to a
  lifecycle via `deriveReadinessLifecycle` (ready ⇔ adapter says ready).
- **Compose profiles** — `search-provider` (Meilisearch), `observability-provider`
  (Prometheus + Tempo + Alertmanager), `workflow-provider` (Windmill + worker +
  backing Postgres/Redis). `make compose-up-search-provider` /
  `make compose-up-observability-provider` / `make compose-up-workflow-provider`.

## Providers

| Provider | Capability | Profile | This pass |
| --- | --- | --- | --- |
| Meilisearch | search-indexing | search-provider | **readiness-proven** (live /health) |
| Prometheus | metrics-traces | observability-provider | **readiness-proven** (live /-/ready) |
| Tempo | metrics-traces (traces) | observability-provider | **readiness-proven** (live /ready, local fs config) |
| Alertmanager | alerting-incident-oncall | observability-provider | **readiness-proven** (live /-/ready) |
| Windmill | workflow-engine | workflow-provider | **compose-backed** (live when profile is up) |
| Temporal | workflow-engine | — | candidate / `not_configured` (probe-ready; not composed) |

## Proof (live)

`proof:composed-provider-readiness` — 9/9 PASS. Live readiness-proven this run:
Meilisearch, Prometheus, Alertmanager (Tempo also up). Windmill is compose-backed
when its profile is started; Temporal remains `not_configured` unless wired. Asserts:
ready iff reachable; lifecycle adapter-confirmed (ready⇒ready, degraded⇒degraded,
not_configured⇒candidate); **no secret in any payload**.

```text
proof:composed-provider-readiness — 9/9 PASS (meilisearch + prometheus + alertmanager live)
```

The proof proves the HONEST readiness contract whether or not a container is up; the
providers observed `ready` are genuinely readiness-proven. A skipped/down provider
reports `degraded`/`not_configured` and never upgrades a status.

## Not delivered (Proposed sub-decisions)

- **Backend integration per provider** — Meilisearch as the active search backend
  (index-per-tenant + reindex producers behind ADR-0060 ports); Prometheus/Tempo as the
  metric/trace store behind the OTEL collector; Alertmanager routing. The built-in
  substrates (ADR-0060 search, ADR-0062 observability) remain the active defaults.
- **Windmill compose + workflow runs** — now compose-backed via
  `make compose-up-workflow-provider`; the workflow engine backend-integration decision
  remains deferred and scheduled jobs stay the built-in default.
- **Temporal** — probe-ready (set `TEMPORAL_HTTP_URL`) but not composed (each needs its
  own DB/topology); the workflow engine remains the ADR-0059 deferred decision.
- Local provider profiles are **dev configs** (Tempo local filesystem, Meilisearch dev
  master key) — not production topologies.

## Linkage

ADR-0071 · ADR-ACT-0271 · registry capability `composed-provider-readiness` (locally
proven) · feeds the provider-config plane (ADR-0070) · credentials via the secret store
(ADR-0069). Classification matrix: the four light providers → `provider available /
readiness-proven`; Windmill → `provider available / compose-backed`; Temporal →
`provider candidate / not configured`.
