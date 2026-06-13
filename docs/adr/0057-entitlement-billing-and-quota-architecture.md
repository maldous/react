# ADR-0057: Billing, invoicing, and payment architecture (Phase 9 provider decision)

> **Re-scoped (ADR-ACT-0256):** this ADR was originally "entitlement, billing, and quota". It has been **split**: entitlements → **ADR-0058** (Accepted); metering + quota enforcement → **ADR-0067** (Accepted, Phase 2). ADR-0057 now covers **billing / invoicing / payment only**, which remains **Proposed** and is **Phase 9 (not delivered)**. This revision (ADR-ACT-0270) hardens the ADR to decision quality: provider direction decided, alternatives rejected with reasons, port seam defined, acceptance criteria and proof requirements named. No billing capability is delivered or live-proven in this pass.

## Status

Proposed (billing provider decision hardened — ADR-ACT-0270; billing / invoicing / payment NOT delivered; Phase 9)

## Date

2026-06-13

## Decision owner

Architecture owner / product owner

## Consulted

Product; finance/billing stakeholder; engineering; security; AI assistant (drafting, human review required).

## Context

After the Phase 1–3.5 delivery (entitlements, metering, quota, API keys, rate limits, secrets, provider config) the billing substrate prerequisites are documented but billing itself is the largest and highest-risk remaining USF capability. Payment capture is the **single capability that cannot be proven locally with free tooling** — it is the one sanctioned paid external dependency in the entire platform. This ADR records:

- the **billing engine direction** (Kill Bill as the primary OSS candidate; Lago as an evaluated alternative requiring a human license decision before adoption);
- the **rejection of OpenMeter** for the billing role (built-in Postgres metering was delivered per ADR-0067; duplicating a metering substrate for billing is waste);
- the **payment gateway isolation model** (Stripe or equivalent behind a `PaymentProviderPort` adapter — real capture is production-only, never locally proved end-to-end);
- the **port seam** (`BillingProviderPort`, `ProductPlanPort`, `SubscriptionPort`, `PaymentProviderPort`) documented as skeleton interfaces so the hexagonal boundary is established before any adapter is written.

The billing engine needs the full prerequisite chain: service catalog (Phase 1) + entitlements (Phase 1) + metering (Phase 2) + quota enforcement (Phase 2) + event bus / durable workers (Phase 5) for dunning automation. Phase 9 is intentionally late on the USF roadmap because of this chain; pulling billing forward would mean building against undelivered substrates.

## Decision (delivered — this pass)

1. **Provider direction decided (Kill Bill as primary OSS billing engine candidate).** Kill Bill (Apache 2.0 licensed, self-hosted, REST/plugin API) is the primary selected OSS billing/subscription engine for Phase 9. It supports plans, prices, subscriptions, invoices, dunning, and a plugin API for payment gateways. It runs locally free (Docker) and is provable end-to-end for the subscription lifecycle without a real payment gateway. The direction is decided; the adapter is NOT written in this pass.

2. **Port seam defined (skeleton, not wired).** Four TypeScript port interfaces are established at `apps/platform-api/src/ports/billing-provider.ts`: `BillingProviderPort` (engine lifecycle + readiness), `ProductPlanPort` (plan + price catalog), `SubscriptionPort` (subscription + invoice operations), and `PaymentProviderPort` (production-external payment capture). These are interface-only skeletons; no adapter, no usecase, no route, no migration exists. Their purpose is to document the hexagonal seam so future adapters have a contract to implement.

3. **Payment gateway isolation decided.** Payment capture (Stripe or equivalent) is **production-external only**, always behind `PaymentProviderPort`. A local mock gateway adapter is required for local subscription-lifecycle proof; the real gateway adapter is written only when a paid account is available and is **never required for local proof**. This is the only sanctioned paid external dependency in the platform.

4. **OpenMeter rejected for the billing role (this decision).** OpenMeter was previously named as the Phase 2 metering compose candidate. Phase 2 delivered built-in Postgres metering (ADR-0067). Composing OpenMeter in addition — and bridging it into a billing engine — would duplicate the metering substrate. The billing engine reads meter aggregates from the existing `MeteringRepository` port; it does not own a separate meter store.

## Decision (Proposed sub-decisions — NOT delivered)

1. **Kill Bill adapter (Phase 9, deferred).** The actual Kill Bill HTTP adapter implementing the ports. Requires a Kill Bill compose profile, migration(s) for local billing metadata, usecase layer, BFF routes, permissions, audit events, tenant isolation, and `proof:billing`.
2. **Lago alternative (human decision required before any adapter is started).** Lago (AGPL-3.0) is a usage-billing alternative with strong metering/invoice UX. **License review is required before adopting Lago** — the AGPL-3.0 network-copyleft implications must be reviewed by a human with legal authority. Kill Bill (Apache 2.0) avoids this gate. If the Lago license is cleared, Lago may replace Kill Bill behind the same ports; the ports are engine-agnostic. Until the license decision is recorded, Kill Bill is the working direction.
3. **Payment gateway adapter (Phase 9, deferred).** The real `PaymentProviderPort` adapter for Stripe (or approved equivalent). Requires a live paid account, is never locally provable end-to-end, and is classified production-external. The local mock adapter must pass `proof:billing-mock-gateway` before the real adapter is attempted.
4. **Billing portal UI (Phase 9, deferred).** Self-service `/admin/billing`, plan selection, invoice history, dunning notices. Gated on the subscription lifecycle being live-proven.
5. **Dunning automation (Phase 9, deferred).** Overdue-invoice retry/cancellation driven by the Phase-5 durable worker + event substrate. Not started until the billing engine adapter is live-proven; needs a durable workflow engine for complex retry logic.

### Alternatives considered

1. **Kill Bill (Apache 2.0) as the primary OSS billing engine (chosen direction).** Self-hosted, REST API, plugin model for payment gateways, full subscription lifecycle including dunning. Apache 2.0 requires no legal gate. Provable locally free. The plugin API is the natural payment-gateway seam. Heavier compose footprint is a known trade-off.
2. **Lago (AGPL-3.0) as the primary engine.** Strong usage-billing model. Rejected as the default pending **explicit AGPL-3.0 license review** by a human with legal authority. Substitutable behind the same ports if cleared.
3. **OpenMeter as billing substrate (rejected).** OpenMeter is a metering aggregator; Phase 2 already delivered built-in Postgres metering (ADR-0067). Using it for billing conflates metering with billing/invoicing/subscriptions and duplicates the metering substrate.
4. **Stripe Billing / Chargebee / Recurly as the primary engine (rejected for the OSS role).** Paid managed SaaS — cannot be proven locally free, and moving the subscription/invoice model off-platform removes self-hosted/air-gapped deployment. They remain valid as the payment-capture adapter behind `PaymentProviderPort`.
5. **Build plans/subscriptions/invoices fully in-platform (rejected for Phase 9).** Consistent with the metering/quota built-in patterns, but billing-ledger correctness, idempotency, dunning, and invoice rendering are specialist concerns; an OSS engine behind the port is the safer risk-adjusted choice. Still possible behind the same ports if the engine proves inadequate.
6. **LocalStack Billing (mock).** LocalStack provides no billing mock. Not applicable.

### Rejected alternatives (required)

- **Adopting Lago without a license review** — rejected: AGPL-3.0 network-copyleft requires an explicit human legal decision; Kill Bill is the working direction until cleared.
- **Using OpenMeter for billing** — rejected: metering is already delivered (ADR-0067); OpenMeter for billing duplicates it and blurs "how much was used" vs "what to charge".
- **Payment capture as a local dependency** — rejected: real gateway round-trips are not locally provable free; the gateway is production-external behind `PaymentProviderPort`; a mock satisfies local proof.
- **Billing engine accessed outside the hexagonal port** — rejected: all engine access goes through the ports; no direct Kill Bill HTTP from usecases.
- **Billing portal or dunning before the subscription lifecycle is live-proven** — rejected: gated on `proof:billing`.
- **Marking billing delivered without a live subscription lifecycle proof** — rejected: `proof:billing` (plan→subscription→invoice against a live engine) is the minimum gate; no status upgrade from a skipped proof.
- **Mixing billing-engine credentials with config in plaintext** — rejected: engine credentials/webhook secrets are stored via `SecretStorePort` (ADR-0069) and referenced by `credentialRef` through the provider config plane (ADR-0070).

### Accepted decision

Kill Bill (Apache 2.0) as the primary OSS billing/subscription engine candidate for Phase 9, behind the `BillingProviderPort` / `ProductPlanPort` / `SubscriptionPort` seam. Payment capture isolated behind `PaymentProviderPort` as the single production-external adapter. OpenMeter rejected for billing. Lago retained as a named alternative pending AGPL-3.0 license review. No billing capability is delivered or live-proven in this pass.

## Implementation phases

1. **Provider decision + port seam (this pass — ADR-ACT-0270).** Direction decided (Kill Bill primary, Lago pending license review, OpenMeter rejected). Port skeletons at `apps/platform-api/src/ports/billing-provider.ts`. No adapter/usecase/migration/route/UI. Not delivered.
2. **Phase 9 prerequisites.** The full chain must be live-proven: service catalog + entitlements (Phase 1, done), metering + quota (Phase 2, done), event bus + durable workers (Phase 5, done), scheduled jobs (Phase 5.5, done). The workflow engine must be delivered for dunning automation — or dunning deferred until after it.
3. **Kill Bill compose + engine adapter (Phase 9, future).** Compose profile (`make compose-up-billing`); migration(s) for a local billing-metadata mirror; port adapters against Kill Bill REST; billing usecase layer (audited, tenant-isolated); `PaymentProviderPort` mock for local proof; BFF routes (`/api/org/billing/*`) + OpenAPI; permissions; `/admin/billing` UI. Evidence: `docs/evidence/platform/phase-9-billing.md`.
4. **Live proof gate (Phase 9, future).** `proof:billing`, `proof:billing-mock-gateway`, `proof:billing-routes`. Status upgrade only after proofs pass.
5. **Real payment gateway adapter (production follow-up).** `PaymentProviderPort` for Stripe (or approved). Requires a live paid account; classified `production_only`; never required for local proof.
6. **Dunning automation (Phase 9 follow-up).** Overdue-invoice durable worker + dunning events on the Phase-5 outbox, triggered by a scheduled job; gated on the lifecycle being live-proven.

## Acceptance criteria

- Kill Bill runs locally free under `make compose-up-billing`; a plan, subscription, and invoice are created/retrieved against the live engine (`proof:billing`).
- A mock payment capture adapter satisfies `proof:billing-mock-gateway`; the mock is classified forbidden-in-production; the real gateway adapter is never required for `proof:billing`.
- Tenant isolation: one tenant's subscription/invoice records are never readable by another; all mutations audited (audit-before-change); no engine credential/webhook secret appears in plaintext in logs, config, or any response.
- Billing-engine credentials are stored via `SecretStorePort` and referenced only by opaque `secret:` refs through the provider config plane.
- The ports are the only permitted interfaces to the engine; no direct Kill Bill HTTP from usecases.
- No billing capability is marked anything other than `missing`/`partial` until `proof:billing` passes against a live engine.
- Lago is NOT adopted until an explicit AGPL-3.0 license decision is recorded in ACTION-REGISTER.

## Proof requirements

- `proof:billing` — plan → subscription → invoice round-trip against live Kill Bill with a mock payment adapter. SKIP honestly when Kill Bill is not running; no status upgrade from a skipped proof.
- `proof:billing-mock-gateway` — mock `PaymentProviderPort`: charge, refund, webhook receipt; classified forbidden-in-production.
- `proof:billing-routes` — BFF billing routes: access-control, tenant isolation, audit events.
- (Production follow-up, not local) `proof:billing-payment-gateway` — real gateway round-trip; requires a paid account; the single documented local-proof gap.

## Production blockers

- **Kill Bill production topology is not decided** (the local profile is a single-node container; HA/DB/plugin isolation review required).
- **Real payment capture requires a paid gateway account** — not provable locally free; the `PaymentProviderPort` mock is the local substitute.
- **Lago license not cleared** — Lago (AGPL-3.0) is not adopted until reviewed; a later switch requires a migration ADR.
- **Billing-engine credentials must go through SecretStorePort (ADR-0069) + the provider config plane (ADR-0070)** — both delivered; billing integration must use them.
- **Dunning requires a workflow engine** — Phase-5.5 delivers fixed-interval jobs; dunning retry logic needs a durable workflow engine (not yet delivered); defer or simplify until then.

## Consequences

Positive: the port seam is established before any adapter; Kill Bill (Apache 2.0) is composable + provable locally free; the payment gateway is isolated and classified production-external from the start; OpenMeter duplication is avoided; the Lago license gate prevents inadvertent AGPL exposure.

Negative: Kill Bill is a heavier compose service than a built-in substrate; a future engine switch requires a new adapter (no usecase change). The real payment-capture gap is explicitly documented and not closeable locally.

Neutral / operational: engine credentials are operator-managed via the provider config plane + secret store; billing mutations are audited; tenant isolation follows the platform RLS + audit-before-change pattern.

## Validation / evidence

Evidence level: High (financial + tenant-isolation risk). This pass: decision quality only — no live proof, no evidence document. Phase 9 delivery evidence: `docs/evidence/platform/phase-9-billing.md` (to be created when the lifecycle is live-proven).

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md`. ADR-ACT-0241 (billing discovery — Open) tracks Phase 9 readiness. ADR-ACT-0270 (this pass) records the provider decision. A Lago license review must produce an explicit ACTION-REGISTER row before any Lago adapter work.

## References

ADR-0015, ADR-0053, ADR-0054, ADR-0055, ADR-0056, ADR-0058, ADR-0067, ADR-0059, ADR-0069, ADR-0070.

## Notes

Re-scoped at ADR-ACT-0256 (entitlements → ADR-0058; metering + quota → ADR-0067). This ADR is scoped to **billing / invoicing / payment only** and remains **Proposed / Phase 9 / not delivered**. The provider direction (Kill Bill primary, Lago pending license review, OpenMeter rejected, payment gateway production-external) is decided at ADR-ACT-0270. Billing must NOT be marked delivered until `proof:billing` passes against a live composed Kill Bill instance.
