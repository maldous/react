# ADR-0054: Build-versus-compose decision framework

## Status

Accepted (2026-06-13, ADR-ACT-0254 — hardened to decision quality; accepted on Matt's authority per the Quad directive)

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

### Alternatives considered

1. **A scored rubric with default biases (chosen).** Consistent, reviewable, records the trigger that would change a defer/reject.
2. **Always build in-house.** Maximal control but reinvents commodity engines (search, workflow, metering) and bloats maintenance.
3. **Always compose OSS.** Fast but composes speculatively, adds operational sprawl, and risks license/isolation problems.

### Rejected alternatives

- (2) Always-build — rejected: wasteful for commodity engines with strong OSS options.
- (3) Always-compose — rejected: violates "never compose speculatively" and the local-first/isolation guards.

### Acceptance criteria

- Every capability records a `decision` (build/compose/adapter/defer/reject) in the registry with a rationale.
- No `compose`/`adapter` capability lacks a free local-first proof path; license is checked against `license:policy` (GPL/AGPL/SSPL/Commons-Clause flagged).
- Deferred/rejected entries record the trigger/why.

### Implementation phases

Governance: applied at the start of every capability ADR (ADR-0055..0066) and recorded in the registry `decision` field. No runtime delivery.

### Proof requirements

`npm run usf:validate` (every production candidate names a local free path). No runtime proof — decision artifact.

### Production blockers

None (decision artifact).

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

Accepted on 2026-06-13 (ADR-ACT-0254) on Matt's authority per the Quad directive. The framework is advisory input to per-capability ADRs and does not weaken any security/isolation/audit rule.
