# ADR-0071: Composed provider readiness (search / observability / workflow)

## Status

Accepted (2026-06-13, ADR-ACT-0271 — composed-provider readiness pass; accepted on Matt's authority per the directive). The readiness spine (port + generic HTTP probe + compose profiles + live proof) is **delivered + live-proven**. The composed providers are made **available + readiness-proven** behind the spine; **using them as the actual backend** (Meilisearch as the search engine, Prometheus/Tempo as the metrics/trace store, a real workflow engine) remains a **Proposed** sub-decision per provider — the built-in substrates (ADR-0060 search, ADR-0062 observability, ADR-0059 events) stay the defaults.

## Date

2026-06-13

## Decision owner

Architecture owner / platform owner

## Consulted

Platform; observability; security; AI assistant (drafting, human review required).

## Context

ADR-ACT-0264 classified Meilisearch / Prometheus / Tempo / Alertmanager / Windmill / Temporal as `provider candidate / not integrated`. The next honest step is to make them _available and readiness-probed_ behind a port — without faking integration. A running container is not a capability; but a container with a live, port-backed readiness probe feeding the provider-config adapter-confirmed lifecycle (ADR-0070) is a genuine, provable provider-availability deliverable. This ADR adds that spine and composes the light providers so their readiness is live-proven; the heavier ones (Windmill/Temporal) are probe-ready and report `not_configured` until wired.

## Decision (delivered)

1. **`ProviderReadinessProbe` port + generic `HttpProviderReadinessProbe` adapter (build):** one capability-agnostic probe that GETs a provider's health endpoint with the global `fetch` (NO new npm dependency) and classifies honestly — `not_configured` (no endpoint wired), `ready` (health 2xx, optional body predicate), `degraded` (wired but unreachable/unhealthy). The `detail` carries only host + verdict; any auth header (e.g. Meilisearch master key) is sent but NEVER echoed.
2. **Composed provider compose profiles (compose):** `search-provider` (Meilisearch), `observability-provider` (Prometheus + Tempo + Alertmanager). Each per-environment; light providers start with image defaults (Tempo via a minimal local config), so a brought-up container probes `ready`.
3. **Composed-provider readiness usecase + operator route (build):** `getComposedProviderReadiness()` probes every composed provider live and maps each to an adapter-confirmed lifecycle via `deriveReadinessLifecycle` (ADR-0070): a provider is `ready` ONLY when its live probe says ready. `GET /api/admin/providers/readiness` (operator-only `platform.providers.read`); no secret in the payload.
4. **Honest classification (build):** Meilisearch / Prometheus / Tempo / Alertmanager are promoted in the environment-classification matrix to `provider available / readiness-proven` (behind the spine; built-in substrate remains default). Windmill / Temporal stay `provider candidate / not configured` (probe-ready, no default endpoint).

## Decision (Proposed sub-decisions — NOT delivered)

1. **Backend integration per provider (deferred):** Meilisearch as the actual search backend (index-per-tenant + reindex producers behind ADR-0060's `SearchIndexPort`/`SearchQueryPort`); Prometheus/Tempo as the metric/trace store behind the OTEL collector + a `MetricRepository`; Alertmanager routing behind an `AlertProviderPort`. The built-in substrates remain the proven defaults until each integration is itself live-proven.
2. **Windmill / Temporal compose + workflow run (deferred):** these need their own database and a non-trivial topology; they are probe-ready (set `WINDMILL_URL`/`TEMPORAL_HTTP_URL` to probe) but not composed here. The workflow engine remains the ADR-0059 deferred decision; scheduled jobs (ADR-0059 Phase 5.5) stay the built-in default.

### Alternatives considered

1. **One generic HTTP readiness probe + per-provider compose, feeding the provider-config lifecycle (chosen).** DRY (one adapter for all HTTP-health providers), no new dependency, composes with ADR-0070; readiness is live-proven where the container is up and honest where it is not.
2. **A bespoke client SDK per provider.** Rejected for the readiness pass — health endpoints are simple HTTP; SDKs add dependencies and audit surface for no readiness benefit. SDKs belong to the (deferred) backend-integration sub-decisions.
3. **Mark the providers delivered on compose availability.** Rejected — a container is not a capability; readiness must be probe-confirmed, and backend integration is a separate, separately-proven concern.
4. **Compose Windmill/Temporal now.** Rejected for this pass — they need their own DBs/topology; composing them "to say they exist" violates the no-fake-readiness rule. Probe-ready + `not_configured` is the honest state.

### Rejected alternatives (required)

- **Faking provider readiness** — rejected: unreachable ⇒ `degraded`, no endpoint ⇒ `not_configured`; never `ready` without a live 2xx.
- **Echoing a provider secret (master key/token) in the readiness payload** — rejected: auth headers are sent, never returned; the proof asserts no secret field.
- **Lifecycle `ready` from compose availability alone** — rejected: lifecycle is adapter-confirmed via `deriveReadinessLifecycle`.
- **Claiming Meilisearch/Prometheus/Tempo are the active backend** — rejected: they are readiness-proven providers; backend integration is a deferred sub-decision; the built-in substrate stays default.

### Accepted decision

Adopt option 1: a generic readiness probe + compose profiles for the light providers + an operator readiness route, feeding the provider-config adapter-confirmed lifecycle. Backend integration + Windmill/Temporal compose are deferred sub-decisions.

## Implementation phases

1. **Readiness spine (this pass, done):** `ProviderReadinessProbe` port, `HttpProviderReadinessProbe` adapter, `composed-providers` usecase + `GET /api/admin/providers/readiness`, `search-provider` + `observability-provider` compose profiles (+ Tempo config), `proof:composed-provider-readiness`.
2. **Backend integration (future, per provider):** Meilisearch search backend, Prometheus/Tempo metric/trace store, Alertmanager routing, Windmill/Temporal workflow runs — each behind its capability port, each separately live-proven.

## Acceptance criteria

- Each composed provider with a reachable health endpoint reports `ready`; a wired-but-unreachable one reports `degraded`; one with no endpoint reports `not_configured` (lifecycle `candidate`). Lifecycle is adapter-confirmed. No secret in any readiness payload. `proof:composed-provider-readiness` proves the contract (live where containers are up).
- The light providers run locally free under `make compose-up-search-provider` / `make compose-up-observability-provider`; the built-in search/observability substrates remain the defaults.

## Proof requirements

`proof:composed-provider-readiness` (honest readiness contract; live readiness for brought-up providers; never faked). This proof proves the readiness spine — it does NOT claim backend integration.

## Production blockers

- Backend integration is not delivered (search/metrics/traces/workflow still served by the built-in substrates).
- Windmill/Temporal are not composed (probe-ready, `not_configured`); the workflow engine remains the ADR-0059 deferred decision.
- Local provider profiles are dev configurations (e.g. Tempo local filesystem backend, Meilisearch dev master key) — not production topologies.

## Consequences

Positive: composed providers are genuinely available + readiness-proven behind one DRY port, composing with the provider-config plane (ADR-0070) and secret store (ADR-0069) for credentials-by-ref; no new dependency; honest per-provider status.

Negative: readiness ≠ backend integration — the providers are not yet the active backend (the built-in substrates remain default); Windmill/Temporal compose is deferred.

Neutral / operational: readiness is operator-visible (`/api/admin/providers/readiness`); endpoints are env-driven; no secret leaks.

## Validation / evidence

Evidence level: Medium (no tenant data in a readiness probe; secret-leak guard asserted). Local proof via `proof:composed-provider-readiness`. Evidence: `docs/evidence/platform/composed-provider-readiness.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0271). Builds on ADR-0070 (provider config) + ADR-0069 (secrets). Backend integration sub-decisions to be scheduled per provider.

## References

ADR-0055, ADR-0056, ADR-0059, ADR-0060, ADR-0062, ADR-0069, ADR-0070.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0271) on Matt's authority per the directive. Composed providers are readiness-proven, NOT integrated as backends; the built-in substrates remain the defaults. Windmill/Temporal are probe-ready but not composed.
