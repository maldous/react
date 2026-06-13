// ---------------------------------------------------------------------------
// Billing provider ports (ADR-0057 / ADR-ACT-0270) — Phase 9 port seam (SKELETON).
//
// Hexagonal ports documenting the billing surface. These are SKELETON interfaces
// ONLY — no adapter, no usecase, no migration, no route exists. Nothing here is wired
// or delivered. The purpose is to establish the hexagonal boundary so a future
// Kill Bill (primary) or Lago (pending AGPL-3.0 license review) adapter has a contract
// to implement. Billing is NOT delivered until proof:billing passes against a live
// composed billing engine.
//
// Structural invariants (enforced by the future usecase + adapters):
//   - all billing-engine access goes through these ports; no direct HTTP to
//     Kill Bill / Lago from usecases;
//   - billing-engine credentials are NEVER plaintext in config or responses — they are
//     stored via SecretStorePort (ADR-0069) and referenced by an opaque secret:<uuid>
//     credentialRef through the provider config plane (ADR-0070);
//   - all mutations are tenant-scoped and audited (audit-before-change);
//   - payment capture (charge/refund) is isolated behind PaymentProviderPort and is the
//     single production-external adapter — never a local-proof requirement; a mock
//     adapter satisfies local proof and is classified forbidden-in-production;
//   - billing reads meter aggregates from MeteringRepository (ADR-0067); it does NOT
//     own a meter store. Plan entitlements gate through EntitlementRepository (ADR-0058).
// ---------------------------------------------------------------------------

// ── BillingProviderPort — engine lifecycle + readiness ─────────────────────

export type BillingEngineStatus = "ready" | "degraded" | "unavailable";

export interface BillingEngineReadiness {
  status: BillingEngineStatus;
  /** Human-readable; must not contain credentials or secret values. */
  detail: string;
}

export interface BillingAccount {
  /** Opaque external account id in the billing engine (e.g. Kill Bill accountId). */
  externalAccountId: string;
  organisationId: string;
  currency: string;
  createdAt: string | null;
}

export interface CreateBillingAccountInput {
  organisationId: string;
  /** ISO 4217 currency code (e.g. "USD"). */
  currency: string;
  /** Display name forwarded to the engine. No secret fields. */
  name: string;
  actorId: string;
}

export interface BillingProviderPort {
  /** Honest engine probe (never faked). Degraded/unavailable when unreachable. */
  readiness(): Promise<BillingEngineReadiness>;
  /** Idempotently provision a billing-engine account for a tenant. Audited. */
  ensureAccount(input: CreateBillingAccountInput): Promise<BillingAccount>;
  /** The tenant's billing-engine account, or null. Tenant-scoped. */
  getAccount(organisationId: string): Promise<BillingAccount | null>;
  /** Verify an inbound engine webhook signature. The raw body is never logged. */
  validateWebhookSignature(rawBody: Buffer, signature: string): Promise<boolean>;
}

// ── ProductPlanPort — plan + price catalog ─────────────────────────────────

export type BillingPeriod = "monthly" | "annual" | "one_time";
export type PriceType = "flat" | "per_unit" | "tiered";

export interface ProductPlan {
  planId: string;
  name: string;
  currency: string;
  billingPeriod: BillingPeriod;
  isActive: boolean;
  createdAt: string | null;
}

export interface PlanPrice {
  priceId: string;
  planId: string;
  priceType: PriceType;
  /** Unit amount in the smallest currency unit (e.g. cents). */
  unitAmount: number;
  currency: string;
  billingPeriod: BillingPeriod;
}

export interface CreatePlanInput {
  name: string;
  currency: string;
  billingPeriod: BillingPeriod;
  unitAmount: number;
  priceType: PriceType;
  actorId: string;
}

export interface ProductPlanPort {
  listPlans(): Promise<ProductPlan[]>;
  getPlan(planId: string): Promise<ProductPlan | null>;
  createPlan(input: CreatePlanInput): Promise<{ plan: ProductPlan; price: PlanPrice }>;
  listPrices(planId: string): Promise<PlanPrice[]>;
  deactivatePlan(planId: string, actorId: string): Promise<boolean>;
}

// ── SubscriptionPort — subscriptions + invoices ────────────────────────────

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled"
  | "unpaid"
  | "paused";

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export interface Subscription {
  subscriptionId: string;
  organisationId: string;
  planId: string;
  priceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
}

export interface Invoice {
  invoiceId: string;
  organisationId: string;
  subscriptionId: string | null;
  status: InvoiceStatus;
  /** Amounts in the smallest currency unit (e.g. cents). */
  amountDue: number;
  amountPaid: number;
  currency: string;
  dueDate: string | null;
  createdAt: string | null;
}

export interface CreateSubscriptionInput {
  organisationId: string;
  planId: string;
  priceId: string;
  externalAccountId: string;
  actorId: string;
}

export interface SubscriptionPort {
  createSubscription(input: CreateSubscriptionInput): Promise<Subscription>;
  getSubscription(organisationId: string, subscriptionId: string): Promise<Subscription | null>;
  listSubscriptions(organisationId: string): Promise<Subscription[]>;
  cancelSubscription(
    organisationId: string,
    subscriptionId: string,
    actorId: string
  ): Promise<Subscription>;
  listInvoices(organisationId: string): Promise<Invoice[]>;
  getInvoice(organisationId: string, invoiceId: string): Promise<Invoice | null>;
}

// ── PaymentProviderPort — payment capture (production-external only) ────────

export type PaymentOutcome = "succeeded" | "requires_action" | "failed";

export interface ChargeResult {
  chargeId: string;
  outcome: PaymentOutcome;
  failureReason: string | null;
}

export interface RefundResult {
  refundId: string;
  amountRefunded: number;
  succeeded: boolean;
}

export interface ChargeInput {
  organisationId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  /** A gateway-issued payment-method reference — NOT a raw card number. */
  paymentMethodToken: string;
  idempotencyKey: string;
}

export interface PaymentProviderPort {
  /** Charge a payment method. Idempotent by idempotencyKey. Never returns raw card data. */
  charge(input: ChargeInput): Promise<ChargeResult>;
  /** Full/partial refund of a prior charge. Operator-initiated; audited. */
  refund(chargeId: string, amount: number, actorId: string): Promise<RefundResult>;
  /** Honest readiness probe (mock in test; real adapter probes the gateway). */
  readiness(): Promise<{ status: "ready" | "degraded"; detail: string }>;
}
