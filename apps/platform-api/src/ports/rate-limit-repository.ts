// ---------------------------------------------------------------------------
// Rate-limit repository port (ADR-0065 / ADR-ACT-0257).
//
// Per-tenant rate-limit policy definitions + a durable fixed-window counter.
// `entitlementKey` bridges to the entitlement substrate — the rate-limit usecase
// checks the entitlement BEFORE the limit (deny-by-default, same ordering as quota).
// The Postgres counter is the local-first store; Redis is a Phase-3.5 provider
// behind this same port. No secret fields.
// ---------------------------------------------------------------------------

export interface RateLimitPolicyRecord {
  policyKey: string;
  entitlementKey: string;
  limit: number;
  windowSeconds: number;
  action: "allow" | "deny";
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpsertRateLimitInput {
  organisationId: string;
  policyKey: string;
  entitlementKey: string;
  limit: number;
  windowSeconds: number;
  action: "allow" | "deny";
  updatedBy: string;
}

export interface RateLimitRepository {
  getByKey(organisationId: string, policyKey: string): Promise<RateLimitPolicyRecord | null>;
  listForTenant(organisationId: string): Promise<RateLimitPolicyRecord[]>;
  listForTenantAsOperator(organisationId: string): Promise<RateLimitPolicyRecord[]>;
  upsert(input: UpsertRateLimitInput): Promise<void>;
  /**
   * Atomically increment the counter for the current fixed window and return the
   * running count (including this hit). `windowSeconds` defines the bucket width.
   */
  incrementAndCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number>;
  /** Read-only current count for the live window (no increment) — for list/peek. */
  currentCount(organisationId: string, policyKey: string, windowSeconds: number): Promise<number>;
}
