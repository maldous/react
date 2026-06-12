# ADR-0055: Service catalog and provider integration model

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; operations; AI assistant (drafting, human review required).

## Context

The repo already has two service registries: `platform-services.ts` (17 services + readiness probes + honest status vocabulary) and `service-clickthrough.ts` (11 services classified `tenant_scoped_safe`/`global_only`/`not_exposed` with isolation invariants). As the foundation adds composed services and provider adapters, these registries must generalise into a coherent **service catalog + provider integration model** so every service is registered, classified, probed, and adapted consistently.

## Decision

1. Treat the existing service/clickthrough registries as the seed of a single **service catalog**: every composed service, mock, shared service, and provider adapter is registered with category, environment classification (ADR-0056), readiness probe, console-access policy, and isolation invariant.
2. Provider integration follows the hexagonal pattern: a capability defines a **port**; concrete providers are **adapters** behind that port (local/OSS adapter for proof, production adapter for deployment). Compute/runtime secrets and provider selection are environment-driven.
3. No service may be added to the catalog without its environment classification, readiness model, and isolation/leakage notes.

## Consequences

Positive: one place to reason about every service; consistent readiness and isolation; clean provider swapping.

Negative: catalog maintenance overhead; existing registries must be refactored toward the generalised shape.

Neutral / operational: the catalog feeds the `/admin/platform` operations cockpit.

## Validation / evidence

Evidence level: Medium. Evidence: `proof:platform-services`, `proof:service-clickthrough-policy`, and the registry `composeSupport`/`environmentModel` fields.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0239).

## References

ADR-0053, ADR-0056, ADR-ACT-0228, ADR-ACT-0233.

## Notes

Proposed; acceptance requires human review.
