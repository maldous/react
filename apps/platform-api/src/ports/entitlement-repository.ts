// ---------------------------------------------------------------------------
// Entitlement repository port (ADR-0057 / ADR-0058 / ADR-ACT-0254)
//
// Tenant-scoped entitlement grants. "What is this tenant allowed to use?" —
// server-authoritative, system-operator managed, audited at the usecase layer.
//
// Two read paths, by authority:
//   - listForTenant(orgId)        — tenant self-read, RLS-isolated (withTenant)
//   - listForTenantAsOperator(..) — system-operator cross-tenant read (withSystemAdmin)
// Mutations (upsert) are operator-only (withSystemAdmin) and MUST be preceded by an
// audit write at the usecase layer (audit-before-change). A tenant can never mutate
// its own entitlements (deny-by-default; no self-grant).
// ---------------------------------------------------------------------------

export type EntitlementGrantState = "granted" | "revoked";
export type EntitlementGrantSource = "system" | "migration" | "seed";

export interface EntitlementGrantRecord {
  organisationId: string;
  entitlementKey: string;
  state: EntitlementGrantState;
  source: EntitlementGrantSource;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpsertEntitlementInput {
  organisationId: string;
  entitlementKey: string;
  state: EntitlementGrantState;
  source: EntitlementGrantSource;
  metadata?: Record<string, unknown>;
  updatedBy: string;
}

export interface EntitlementRepository {
  /** Tenant self-read: returns the calling tenant's grant rows (RLS-scoped). */
  listForTenant(organisationId: string): Promise<EntitlementGrantRecord[]>;
  /** Operator read: returns one tenant's grant rows (rls_bypass). */
  listForTenantAsOperator(organisationId: string): Promise<EntitlementGrantRecord[]>;
  /** Operator read of a single grant (rls_bypass); null when no row exists. */
  getGrant(organisationId: string, entitlementKey: string): Promise<EntitlementGrantRecord | null>;
  /** Operator upsert of a grant state (rls_bypass). Caller must audit first. */
  upsert(input: UpsertEntitlementInput): Promise<EntitlementGrantRecord>;
}
