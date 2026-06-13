# ADR-0057: Entitlement, billing, and quota architecture

## Status

Proposed

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

Remains **Proposed** (NOT accepted in ADR-ACT-0254): too broad — it bundles entitlements + metering + quota + billing + payment. It must be **split** into per-capability decisions (or have per-sub acceptance criteria appended) and hardened before acceptance. Discovery (Lago vs OpenMeter vs Kill Bill vs custom ledger) precedes implementation. Note: the entitlement engine + quota HOOK were delivered in Phase 1 under ADR-0058/ADR-ACT-0254; real quota enforcement + billing remain Phase 2/9.
