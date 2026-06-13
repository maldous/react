# ADR-0053: Universal Service Foundation scope and principles

## Status

Accepted (2026-06-13, ADR-ACT-0254 — hardened to decision quality; accepted on Matt's authority per the Quad directive)

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

### Alternatives considered

1. **An explicit scope + non-negotiable principles ADR (chosen).** One governing decision that every later capability ADR inherits.
2. **No scope ADR; decide per capability.** Lower up-front cost but invites scope creep, fake readiness, and inconsistent local-first/isolation guarantees.
3. **A product roadmap document instead of an ADR.** Communicates intent but carries no governance force and is not validated.

### Rejected alternatives

- (2) Per-capability-only — rejected: the failure mode this ADR exists to prevent.
- (3) Roadmap-only — rejected: not enforceable; `usf:validate` needs a decision to enforce against.

### Acceptance criteria

- Every USF capability is expressed through the full hexagonal checklist (point 4) before being called delivered.
- No capability requires a paid SaaS account for local proof (payment capture excepted, isolated behind an adapter).
- Status uses the controlled vocabulary; the word "complete" never appears; `usf:validate` is green.

### Implementation phases

This ADR is governance; it ships as the matrix + registry + validator (delivered, ADR-ACT-0237) and is applied by every later phase (roadmap Phases 1–10).

### Proof requirements

`npm run usf:validate` (registry/matrix honesty + delivery-graph integrity). No runtime proof — this is a decision artifact.

### Production blockers

None (decision artifact). It gates other capabilities' production readiness via the checklist.

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

Accepted on 2026-06-13 (ADR-ACT-0254) on Matt's authority per the Quad directive: the decision is correct, internally consistent, and implementation-ready. Acceptance does not weaken any security, isolation, audit, or no-fake-readiness rule.
