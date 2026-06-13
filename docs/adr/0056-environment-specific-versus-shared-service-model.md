# ADR-0056: Environment-specific versus shared service model

## Status

Accepted (2026-06-13, ADR-ACT-0254 — hardened to decision quality; accepted on Matt's authority per the Quad directive)

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Operations; security; data; AI assistant (drafting, human review required).

## Context

Some services hold environment-specific tenant runtime data (Postgres, Redis, MinIO, ClickHouse, Keycloak) and must be per-environment. Others are engineering-quality or cross-cutting (SonarQube, Sentry) and may be shared if they isolate properly. Mock services (WireMock, LocalStack, mock-oidc) must never run in production. New foundation services need a single, enforced classification model so shared services do not leak tenant data across environments.

## Decision

Classify every service using the controlled vocabulary: `per-environment`, `shared-cross-environment`, `local-only`, `test-only`, `mock-only`, `production-external`, `production-internal`, `forbidden-in-production`. The reasoning and per-service classification live in `docs/architecture/environment-service-classification.md`.

A service may be **shared-cross-environment only if** it provides all of: environment tagging; tenant tagging where tenant data exists; access controls; retention controls; backup, restore, and deletion models; an audit model; a readiness proof; and a written data-leakage analysis. Tenant runtime data defaults to per-environment. Mocks are forbidden in production.

### Alternatives considered

1. **Controlled vocabulary + a strict shared-service checklist (chosen).** Defaults tenant data to per-environment; only allows sharing when leakage is provably controlled.
2. **Share infrastructure freely to cut cost.** Lower spend but high cross-environment/tenant leakage risk; incompatible with tenant isolation.
3. **Everything strictly per-environment.** Safest but wasteful for non-tenant-runtime engineering tools (Sonar, Sentry) and the metadata-only data catalog.

### Rejected alternatives

- (2) Share-freely — rejected: violates tenant isolation; no leakage analysis.
- (3) Strict-per-environment-only — rejected: needlessly duplicates engineering-quality tooling that holds no tenant runtime data.

### Acceptance criteria

- Every service in the catalog carries a classification from the vocabulary; tenant runtime data is per-environment.
- Every `shared-cross-environment` service satisfies the full checklist incl. a written leakage analysis.
- Mock services are `mock-only`/`forbidden-in-production`, profile-gated, and never selectable in production; `usf:validate` enforces gating.

### Implementation phases

Governance: applied whenever a service is added to the catalog (ADR-0055). Enforced by `usf:validate` (shared-isolation notes + forbidden-mock gating).

### Proof requirements

`npm run usf:validate` (shared services carry isolation notes; mock services are profile-gated) and `proof:service-catalog-registry` (classification completeness, no mock-in-production).

### Production blockers

A shared-cross-environment service cannot go to production without its full checklist + leakage analysis.

## Consequences

Positive: prevents cross-environment and cross-tenant leakage; makes shared-service risk explicit.

Negative: shared services carry a heavier compliance checklist; more per-environment infrastructure to operate.

Neutral / operational: existing classifications (Sonar shared, Sentry shared errors-only, mocks dev/test) are formalised, not changed.

## Validation / evidence

Evidence level: Medium. Evidence: the classification document and the registry `environmentModel`/`sharedPerEnv` fields validated by `npm run usf:validate`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0238).

## References

ADR-0017, ADR-0029, ADR-0034, ADR-0053, ADR-ACT-0089.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0254) on Matt's authority per the Quad directive. Acceptance strengthens, and does not weaken, tenant isolation and the no-mock-in-production rule.
