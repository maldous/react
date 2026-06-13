# ADR-0055: Service catalog and provider integration model

## Status

Accepted (2026-06-13, ADR-ACT-0254 — hardened to decision quality in ADR-ACT-0253; accepted on Matt's authority per the Quad directive)

## Date

2026-06-13 (hardened 2026-06-13, ADR-ACT-0253)

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; operations; security; product owner; AI assistant (drafting + option comparison, human review required).

## Context

The repo already has two service registries: `apps/platform-api/src/usecases/platform-services.ts` (17 services + a background worker, each with a readiness probe and an honest 8-value status vocabulary) and `apps/platform-api/src/usecases/service-clickthrough.ts` (services classified `tenant_scoped_safe` / `global_only` / `not_exposed` with explicit isolation invariants). It also has `capability-registry.ts` (44 product/control-plane capabilities with `implementationStatus` + readiness model).

The Universal Service Foundation (ADR-0053) will add composed services (search, workflow, metering, metrics/trace backends, billing engine, secrets, support desk, data catalog) and provider adapters. Without one coherent **service catalog + provider integration model**, each new service would be wired ad hoc: inconsistent readiness, inconsistent isolation, accidental exposure of operator-only tools to tenants, and the standing risk of treating a running container or a mock as a product capability.

This ADR defines that model. It is the **Phase 1 dependency spine** for the rest of the USF: `delivery.requiredDependencyTruths` already enforces that every provider-backed capability transitively depends on `service-catalog-provider-model`.

## Service catalog purpose

The service catalog is the single, server-owned registry of **every backing service** the platform depends on — composed (Postgres, Redis, MinIO, ClickHouse, Keycloak, Loki/Grafana, future search/workflow/metering engines), mock (WireMock, LocalStack, mock-oidc), shared (SonarQube, Sentry), and provider adapters (S3, Cloudflare, payment, KMS). For each service the catalog records: identity, category, **environment classification** (ADR-0056), **readiness probe + status**, **console-access / clickthrough policy** (ADR-ACT-0233), **isolation/leakage invariant**, and the **port** it sits behind (if provider-backed). It is the source of truth that drives the `/admin/platform` operations cockpit and the tenant-facing readiness surface.

## Provider registry model

A **capability** defines a hexagonal **port**. A **provider** is a concrete implementation of that port, registered against the capability with: provider id, the port it satisfies, environment classification, a readiness probe, a selection key (env-driven), and an isolation note. The provider registry answers "for capability X in environment E, which adapter is active, is it ready, and is it isolated?" Provider selection is environment-driven configuration, never hard-coded in React or leaked to the client.

Catalog entry vs provider entry: the **catalog** lists services-as-deployed; the **provider registry** maps capability → port → selectable adapters. A composed service appears in both (it is a deployed service _and_ the local/OSS provider for its capability's port).

## Provider lifecycle

`proposed → classified → composed (local/OSS adapter) → probed → catalogued → tenant-visible (if policy allows) → production-adapter`. A provider may not advance to `catalogued` without an environment classification (ADR-0056), a readiness probe, and an isolation/leakage note. It may not become `tenant-visible` unless its clickthrough policy is `tenant_scoped_safe`. It may not reach `production-adapter` until its production blockers are cleared.

## Build / compose / adapter / defer relationship

The catalog records the ADR-0054 `decision` for each capability and binds it to providers:

- **build** — capability implemented in-repo behind a port; the "provider" is the internal adapter (e.g. entitlements, quotas, API keys, tenant lifecycle).
- **compose** — a free local/OSS service is the local-proof provider behind the port (e.g. Meilisearch, OpenMeter, Windmill); a managed/self-hosted instance is the production provider behind the same port.
- **adapter** — a production provider is unavoidable; a local mock/OSS equivalent is the proof provider (payment gateway, cloud KMS, real external IdP, Cloudflare TLS).
- **defer** — registered with the trigger that would change the decision; no provider until then.

No capability is `compose`/`adapter` unless it has a free local-first proof provider (ADR-0053 principle 2).

## Environment classification

Every catalog entry carries an ADR-0056 classification: `per-environment`, `shared-cross-environment`, `local-only`, `test-only`, `mock-only`, `production-external`, `production-internal`, `forbidden-in-production`. Tenant runtime data defaults to per-environment. Shared services must satisfy the full ADR-0056 isolation/leakage checklist before being catalogued.

## Readiness classification

Readiness reuses the existing honest 8-value vocabulary from `platform-services.ts` (e.g. `up` / `degraded` / `down` / `not_configured` / `unknown` …). Readiness is **probe-derived, never asserted**. A catalog entry with no working probe is `unknown`, not `up`. Readiness is point-in-time; readiness history is a later (Phase 7) concern and must not be faked here.

## Local proof requirements

Catalogue changes are proven by runnable scripts (no live/prod claims):

- `proof:service-catalog-registry` — every catalog entry has identity, category, environment classification, readiness probe, clickthrough policy, and isolation note; no entry is `up` without a real probe result.
- `proof:provider-environment-classification` — every provider has a valid ADR-0056 classification; mocks are `mock-only`/`forbidden-in-production`; shared entries satisfy the checklist.
- `proof:provider-readiness-honesty` — a service that is unreachable reports `down`/`unknown`, never `up`; a `not_configured` provider never reports ready.

## No-fake-readiness rules

A running container is **not** a delivered capability or a ready provider. Readiness must come from a probe. `not_configured`, `unknown`, and `degraded` are first-class honest states. A capability's `implementationStatus`/registry status is independent of its provider's readiness: a provider can be `up` while the capability is still `missing` (the engine runs but nothing is wired to it).

## Relationship to existing modules

- **`platform-services.ts`** — the **seed of the service catalog**. Generalise it: keep its probe + 8-value status model; add the per-entry environment classification, clickthrough policy reference, isolation invariant, and (for provider-backed entries) the port binding. It continues to feed `/admin/platform`.
- **`service-clickthrough.ts`** — the **console-access policy** layer of the catalog. Every catalog entry references its clickthrough classification (`tenant_scoped_safe` / `global_only` / `not_exposed`); the catalog does not duplicate the policy, it points at it (single source of truth, ADR-ACT-0233).
- **`capability-registry.ts`** — the **capability layer** above the catalog. Capabilities define ports; the catalog/provider registry record which services back those ports and whether they are ready. The capability registry keeps owning `implementationStatus` and the tenant readiness model.

## Tenant visibility rules

Tenants see only what their clickthrough policy permits. A catalog entry is exposed to a tenant admin **only** if it is `tenant_scoped_safe`; `global_only` and `not_exposed` entries are never enumerated to a tenant. Tenant-visible entries are filtered server-side by host authority (tenant vs system operator); no secret, internal URL, or cross-tenant signal is ever included in a tenant-facing catalog payload.

## Provider adapter boundary

All access to a composed/provider service goes through its hexagonal port + adapter on the server (BFF). React never talks to a composed service directly; it talks to the BFF, which talks to the adapter, which talks to the provider. The adapter is the only place provider-specific config, credentials, and SDKs live. Swapping local OSS provider ↔ production provider is an adapter/config change behind a stable port, with no change to BFF contracts or React.

## How future composed services become visible in `/admin/platform`

A new composed service appears in the operations cockpit by being **registered in the catalog** (with classification, probe, clickthrough policy, isolation note) — not by editing the UI. `/admin/platform` renders from the catalog + readiness probes + the clickthrough policy (the same single-source pattern as ADR-ACT-0235). Console links derive from the clickthrough policy: `global_only` consoles are operator-only; `tenant_scoped_safe` consoles may be linked for tenants; `not_exposed` services have no link.

## How mocks are prevented from becoming production substrate

Mocks (WireMock, LocalStack, mock-oidc) are catalogued as `mock-only` / `forbidden-in-production`, kept behind Compose profiles (never always-on/default), and `not_exposed` (or `global_only` in dev) in the clickthrough policy. `npm run usf:validate` already fails if any of these is not profile-gated. LocalStack's `secretsmanager` is explicitly **not** the secrets-management provider; the secrets capability binds to OpenBao/KMS adapters only (ADR-0058 secrets sibling; provider-shortlist). A mock may never be selected as the active provider in `staging`/`prod` environment configuration.

## Decision

### Alternatives considered

1. **Generalise the existing registries into one catalog + provider model (chosen).** Reuses `platform-services.ts`, `service-clickthrough.ts`, and `capability-registry.ts`; consistent readiness/isolation; clean provider swapping.
2. **A third-party service catalog (e.g. Backstage) as the system of record.** Heavy to operate; duplicates the honest readiness model already proven here; couples core governance to an external tool.
3. **Per-service ad-hoc wiring (status quo extended).** No central reasoning; inconsistent readiness/isolation; the exact sprawl this ADR prevents.
4. **A generic service mesh / sidecar registry.** Solves transport, not product-capability governance, readiness honesty, or tenant visibility.

### Rejected alternatives

- (2) Backstage-as-source-of-truth — rejected for Phase 1: operational weight and governance coupling; may be reconsidered as a _developer-portal surface_ in Phase 3 (ADR-0065), reading from this catalog, not replacing it.
- (3) Ad-hoc wiring — rejected: it is the failure mode.
- (4) Service mesh — rejected: out of scope; wrong layer.

### Accepted decision

Adopt option 1. Treat `platform-services.ts` as the catalog seed; bind each entry to its ADR-0056 classification, `service-clickthrough.ts` policy, isolation invariant, and (where provider-backed) a port + provider registry entry. Provider selection is environment-driven; all provider access is through ports/adapters on the server. The catalog drives `/admin/platform`. Mocks stay profile-gated, `mock-only`, and non-selectable in production.

### This ADR explicitly rejects

- **Direct React access to composed services** — all server data is via the BFF (CLAUDE.md constraint #1); composed services are reached only through ports/adapters.
- **Exposing global-only tools to tenant admins** — only `tenant_scoped_safe` catalog entries are ever enumerated to a tenant.
- **Treating LocalStack, WireMock, or mock-oidc as production substrate** — they are `mock-only` / `forbidden-in-production`, profile-gated, and non-selectable in staging/prod.
- **Reusing Sentry's internal Kafka/ClickHouse as the platform event bus or analytics warehouse** — those are Sentry-only; the platform event bus (ADR-0059) and analytics/metering warehouse (ADR-0061) are separate per-environment services.
- **Adding any new Compose service before its service-catalog/provider classification exists** — `mustPrecedeCompose` gate; classification (ADR-0056) + catalog entry come first.

## Implementation phases

1. **Catalog v2 schema (Phase 1).** Extend `platform-services.ts` into a catalog with environment classification + clickthrough reference + isolation invariant + optional port binding; no new services composed.
2. **Provider registry (Phase 1).** Introduce a `provider-registry` port: capability → port → {providers with classification, probe, selection key}. Seed it with the already-composed services as their own local providers.
3. **`/admin/platform` reads from catalog v2 (Phase 1).** Render cockpit + console links from the catalog + clickthrough policy (single source).
4. **Provider-backed onboarding (Phase 4+).** Each later composed service (search, workflow, …) registers through this model before it is composed.

## Acceptance criteria

- The catalog enumerates every backing service with: identity, category, environment classification, readiness probe, clickthrough policy reference, isolation invariant, and (if provider-backed) port binding.
- No catalog entry reports `up` without a real probe result; unreachable → `down`/`unknown`.
- `/admin/platform` renders from the catalog; tenant-facing catalog payloads contain only `tenant_scoped_safe` entries and no secrets/internal URLs.
- A provider can be swapped local↔production by config behind a stable port with no BFF/React change.
- Mocks are `mock-only`, profile-gated, and non-selectable in staging/prod; `usf:validate` enforces gating.
- `proof:service-catalog-registry`, `proof:provider-environment-classification`, `proof:provider-readiness-honesty` pass.

## Proof requirements

`proof:service-catalog-registry`, `proof:provider-environment-classification`, `proof:provider-readiness-honesty` (all local, free). Existing `proof:platform-services` and `proof:service-clickthrough-policy` continue to pass.

## Production blockers

- No production provider may be the active provider until its production blockers (per its capability ADR) are cleared.
- Shared-cross-environment catalog entries require the full ADR-0056 checklist + a written leakage analysis before production.
- Readiness history / SLOs are out of scope here (Phase 7, ADR-0062) and must not be implied.

## Consequences

Positive: one place to reason about every service; consistent readiness + isolation; clean provider swapping; safe `/admin/platform` rendering; mocks can't leak into production.

Negative: catalog maintenance overhead; the existing registries must be refactored toward the generalised shape (additive, not a rewrite).

Neutral / operational: the catalog feeds the operations cockpit and the tenant readiness surface; it is the prerequisite for all later composed capabilities.

## Validation / evidence

Evidence level: Medium. Evidence: `proof:platform-services`, `proof:service-clickthrough-policy`, the new `proof:service-catalog-*` scripts, and the registry `composeSupport`/`environmentModel` fields. Phase-1 delivery scope: `docs/evidence/platform/phase-1-service-catalog-entitlements-scope.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0239 service catalog/provider model; ADR-ACT-0253 hardening).

## References

ADR-0053, ADR-0054, ADR-0056, ADR-0058, ADR-0059, ADR-0061, ADR-0065; ADR-ACT-0228, ADR-ACT-0233, ADR-ACT-0235; `docs/evidence/platform/universal-service-foundation-implementation-roadmap.md`.

## Notes

Hardened to decision quality (ADR-ACT-0253) and accepted on 2026-06-13 (ADR-ACT-0254) on Matt's authority per the Quad directive. Acceptance does not weaken any security, isolation, audit, or no-fake-readiness rule.
