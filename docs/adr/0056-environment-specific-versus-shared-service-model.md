# ADR-0056: Environment-specific versus shared service model

## Status

Proposed

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

Proposed; acceptance requires human review.
