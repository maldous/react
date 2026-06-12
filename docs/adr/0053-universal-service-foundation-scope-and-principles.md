# ADR-0053: Universal Service Foundation scope and principles

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Product owner; engineering; security; operations; AI assistant (drafting + option comparison, human review required).

## Context

The platform is a mature **tenant control-plane foundation** (identity, tenancy, auth, config, domains, webhooks, observability readiness, audit). There is intent to evolve it into a **multipurpose software-provider substrate** that can host future SaaS products (billing, search, workflow, notifications, analytics, alerting, data governance, developer platform, support administration).

Without an explicit scope boundary and a shared set of principles, this evolution risks scope creep, fake readiness ("a container exists, therefore the capability is delivered"), and paid-SaaS lock-in that breaks local-first development.

This ADR establishes the scope and the non-negotiable principles. The capability-by-capability state is tracked in `docs/evidence/platform/universal-service-foundation-matrix.md` (ADR-ACT-0237) and its registry.

## Decision

1. The platform's target is a **universal service foundation**: a substrate of composable capabilities expressed through the existing hexagonal style (ADR-0001) — ports, adapters, BFF contracts, route scopes, permission model, tenant isolation, audit, readiness, runtime proof, evidence.
2. **Free local-first** is mandatory. Every capability must have a free local development path. No capability may require a paid SaaS account to run, test, or prove locally. Paid providers may be later production adapters only.
3. **No fake readiness.** A running container is never a delivered capability. Status uses the controlled vocabulary in the matrix; the word "complete" is not permitted.
4. **Compliance with platform architecture** is required for every new capability: ADR + action-register entry + port + adapter + contract + route scope + permission + tenant isolation + audit + readiness + proof + evidence + UI surface where applicable + production classification.
5. The Universal Service Foundation Matrix is the single planning source of truth; the registry JSON is its machine-readable form and is validated in CI.

## Consequences

Positive: a stable scope boundary; honest status reporting; local-first guarantee; consistent architecture for every future capability.

Negative: more up-front governance per capability; some capabilities are slower to add because they must satisfy the full checklist.

Neutral / operational: existing delivered capabilities are unaffected; the matrix becomes a required review artifact for new substrate work.

## Validation / evidence

Evidence level: Medium. Evidence: `docs/evidence/platform/universal-service-foundation-matrix.md`, `universal-service-foundation-registry.json`, and `npm run usf:validate`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0237 and dependents).

## References

ADR-0001, ADR-0007, ADR-0024, ADR-0029, ADR-0030, ADR-0045; `docs/architecture/universal-service-foundation.md`.

## Notes

This is a Proposed scope decision; it is not yet Accepted. Acceptance requires human architecture review.
