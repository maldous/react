# ADR-0057: Billing, invoicing, and payment architecture (re-scoped)

> **Re-scoped (ADR-ACT-0256):** this ADR was originally "entitlement, billing, and quota". It has been **split**: entitlements → **ADR-0058** (Accepted); metering + quota enforcement → **ADR-0067** (Accepted, Phase 2). ADR-0057 now covers **billing / invoicing / payment only**, which remains **Proposed** and is **Phase 9** (not delivered).

## Status

Proposed (billing/invoicing/payment only — Phase 9; NOT delivered)

## Date

2026-06-13

## Decision owner

Architecture owner / product owner

## Consulted

Product; finance/billing stakeholder; engineering; security; AI assistant (drafting, human review required).

## Context

The foundation has feature flags but no entitlement engine, no plan/price/subscription model, no metering, and no quota enforcement. Billing is the highest-risk substrate because payment capture is the one capability that cannot be fully proven locally with free tooling. The architecture must keep entitlements and quota enforcement **built and local-first**, compose metering on the existing ClickHouse, and isolate the paid payment dependency behind an adapter.

## Decision

1. **Entitlements (build):** a tenant/plan entitlement set resolved server-side; features and quotas are gated by entitlement, not raw flags.
2. **Metering (compose):** OpenMeter (OSS, ClickHouse-backed) reusing the already-composed ClickHouse; meter events are tenant-tagged.
3. **Quotas (build):** Redis counters + Postgres limits enforced at the BFF.
4. **Billing (compose + adapter):** plans/prices/subscriptions/invoices via an OSS engine (Lago or Kill Bill) for local proof; **payment capture is a production-external adapter** — explicitly the only paid dependency, never required for local proof.
5. Sequence: entitlements → metering → quotas → billing UI. Billing portal and dunning come last.

## Consequences

Positive: feature gating and quotas proven locally; billing engine swappable; paid surface isolated.

Negative: billing is large (XL); payment flows cannot be end-to-end proven without a real gateway.

Neutral / operational: an immutable billing ledger/audit trail is required.

## Validation / evidence

Evidence level: High (financial + tenant-isolation risk). Local proof for entitlements/metering/quotas; documented gap for payment capture.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0241, ADR-ACT-0245).

## References

ADR-0015 (analytical data), ADR-0053, ADR-0061, ADR-0058.

## Notes

**Split done (ADR-ACT-0256):** entitlements → ADR-0058 (Accepted, delivered Phase 1); metering + quota enforcement → ADR-0067 (Accepted, delivered Phase 2). This ADR is now scoped to **billing / invoicing / payment** only and remains **Proposed / Phase 9 / not delivered**. Billing discovery (Lago vs Kill Bill; payment gateway as a production-external adapter) precedes implementation. Billing must NOT be marked delivered.
