# ADR-0058: Policy decision point and delegated administration

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / security

## Consulted

Security; engineering; AI assistant (drafting, human review required).

## Context

Authorization today uses Keycloak Authorization Services (UMA 2.0) as a Policy Enforcement Point in the BFF pipeline, backed by the real `authorisation-runtime` package. Groups and sub-organisations exist as API-only capabilities; delegated admin roles are deferred; there is no general attribute-based policy model. The foundation needs a clear decision on whether to keep Keycloak UMA as the Policy Decision Point or introduce an external PDP (OPA/Cedar), and how delegated administration is granted.

## Decision

1. **Keep Keycloak UMA as the PDP** for resource/scope decisions. Do **not** add OPA/Cedar unless a concrete attribute-policy requirement is proven that UMA cannot express; if so, integrate it as an adapter behind a PDP port.
2. **Delegated administration (build):** tenant admins may grant scoped admin rights via realm fine-grained admin + custom scope mapping, fully audited. Promote `groups` and `sub-organisations` from API-only to delivered with admin UI.
3. All privileged grants are audited (extends ADR-0040).

## Consequences

Positive: no premature PDP sprawl; reuses proven UMA pipeline; delegation becomes a first-class, audited capability.

Negative: UMA expressiveness limits may surface later; delegated-admin UI and group/sub-org UI are net-new work.

Neutral / operational: PDP port keeps the door open for an external engine without rework.

## Validation / evidence

Evidence level: High (access-control risk). Local proof via `authorize-resource` tests + new delegation proofs.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0242).

## References

ADR-0021, ADR-0030, ADR-0040, ADR-0053.

## Notes

Proposed; acceptance requires human review.
