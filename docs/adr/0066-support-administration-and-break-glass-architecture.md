# ADR-0066: Support administration and break-glass architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / operations / security

## Consulted

Support; operations; security; AI assistant (drafting, human review required).

## Context

An audited, short-lived system-admin support-session exists (ADR-ACT-0187), and tenant provisioning is delivered. There is no break-glass approval workflow, no tenant suspension/deletion/export, no support ticketing, no customer-health signals, no incident communication, and no admin announcements. Host-origin support escalation on tenant hosts is deferred per the bedrock hardening evidence.

## Decision

1. **Break-glass (build):** add an approval workflow (ADR-0059) and richer audit to the existing support-session; define host-origin escalation policy in this ADR before enabling it.
2. **Tenant lifecycle (build):** suspension, deletion, and export — deletion coordinates schema + storage + realm + DSR purge (ADR-0063/0064).
3. **Support desk (compose):** Zammad or Chatwoot (OSS), shared-cross-environment **only** with mandatory tenant tagging, retention, and access control (ADR-0056).
4. **Customer health, incident comms, announcements (build):** operator surfaces built on audit + readiness + notification substrates.

## Consequences

Positive: enterprise support + safe privileged access; reuses workflow/notification/audit substrates.

Negative: tenant deletion is irreversible and high-risk; shared support desk needs strict isolation.

Neutral / operational: break-glass escalation remains gated until its policy is accepted.

## Validation / evidence

Evidence level: High (privileged access + irreversible deletion). New break-glass + tenant-deletion proofs required.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0251).

## References

ADR-0036, ADR-0053, ADR-0059, ADR-0063, ADR-0064, ADR-ACT-0187.

## Notes

Proposed; acceptance requires human review.
