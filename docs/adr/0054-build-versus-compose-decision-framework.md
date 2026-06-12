# ADR-0054: Build-versus-compose decision framework

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; operations; security; AI assistant (drafting, human review required).

## Context

Each universal-foundation capability must be deliberately classified as **build**, **compose** (run a free local/open-source service), **adapter** (integrate via a provider port), **defer**, or **reject** (non-core). Without a shared rubric these decisions are made ad hoc, leading to inconsistent operational burden and accidental rewrites of mature capabilities.

## Decision

Adopt the decision framework in `docs/architecture/build-versus-compose-decision-framework.md`. For every capability, score against: local-first feasibility, license, compose/operational burden, tenant-isolation fit, maturity of existing repo capability, and production-adapter path. The resulting decision is recorded in the matrix registry `decision` field.

Default biases:

- Prefer **build** when the capability is thin, security-sensitive, or already partially present in the repo (e.g. entitlement checks, quota enforcement, API keys).
- Prefer **compose** for mature commodity engines with a strong OSS option and clean tenant-isolation story (e.g. search, workflow, metering, metrics/trace backends).
- Prefer **adapter** when a production provider is unavoidable but a local mock/OSS equivalent exists for proof (e.g. payment gateway, cloud KMS).
- **Defer** when no concrete product need is proven; **reject** when out of foundation scope.

Do not rewrite a mature platform capability unless there is a clear architectural reason recorded in an ADR.

## Consequences

Positive: consistent, reviewable decisions; reduced operational sprawl; explicit rejection of non-core work.

Negative: a decision step is required before each capability is scheduled.

Neutral / operational: the framework is advisory input to per-capability ADRs (ADR-0057..0066).

## Validation / evidence

Evidence level: Low–Medium. Evidence: the framework document and the populated `decision` column in the registry.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0240).

## References

ADR-0053, ADR-0055, ADR-0056.

## Notes

Proposed; acceptance requires human review.
