// ---------------------------------------------------------------------------
// Quota repository port (ADR-0067 / ADR-ACT-0256)
//
// Per-tenant quota definitions (operator-managed). A quota binds an entitlement
// key + meter key + limit + window + action. "Is the next action allowed under
// the tenant's entitlement/limit?" is decided by the quota usecase, which reads a
// quota here and aggregates usage from the metering repository. No secret fields.
// ---------------------------------------------------------------------------

import type { QuotaAction, QuotaWindow } from "@platform/contracts-admin";

export interface QuotaRecord {
  organisationId: string;
  quotaKey: string;
  entitlementKey: string;
  meterKey: string;
  limit: number;
  window: QuotaWindow;
  action: QuotaAction;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpsertQuotaInput {
  organisationId: string;
  quotaKey: string;
  entitlementKey: string;
  meterKey: string;
  limit: number;
  window: QuotaWindow;
  action: QuotaAction;
  updatedBy: string;
}

export interface QuotaRepository {
  /** Tenant self-read of its own quota definitions (RLS-scoped). */
  listForTenant(organisationId: string): Promise<QuotaRecord[]>;
  /** Operator read of a target tenant's quota definitions (rls_bypass). */
  listForTenantAsOperator(organisationId: string): Promise<QuotaRecord[]>;
  /** Read one quota by key, RLS-scoped to the tenant (used by enforcement). */
  getByKey(organisationId: string, quotaKey: string): Promise<QuotaRecord | null>;
  /** Operator upsert of a quota definition (rls_bypass). Caller must audit first. */
  upsert(input: UpsertQuotaInput): Promise<QuotaRecord>;
}
