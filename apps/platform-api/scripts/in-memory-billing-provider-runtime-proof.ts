/**
 * Provider-level proof wrapper for InMemoryBillingProvider and InMemoryPaymentProvider.
 *
 * The delegated proof exercises billing readiness, account creation, charge,
 * and refund behavior; the unit reliability test covers config, secret source,
 * timeout/retry declarations, health, recovery, webhook verification,
 * unavailable-provider, and misconfigured-provider fail-closed paths.
 */
await import("./billing-provider-runtime-proof.ts");
