// ---------------------------------------------------------------------------
// Legal-hold port (ADR-0064 / V1C-12c, decisionRef V1C-12c).
//
// Sole owner of platform-wide legal hold across V1. Retention (V1C-12b) and
// Object Storage (V1C-15) consume the flag, never own it. A consumer must
// call hasActiveLegalHold() before deleting any held record; the runtime
// proof exercises both layers against the same hold.
//
// State machine: active → released (terminal). Idempotent at both edges.
//
// Audit: every set/release is audited BEFORE the DB write at the use-case
// layer (audit-before-change, ADR-0040); a rejected audit means no state
// change. The set/release port methods themselves never audit — only the
// use-case does.
// ---------------------------------------------------------------------------

export type LegalHoldState = "active" | "released";

export interface LegalHoldRecord {
  id: string;
  organisationId: string;
  resourceTable: string;
  rowId: string;
  reason: string;
  state: LegalHoldState;
  setBy: string;
  releasedBy: string | null;
  setAt: string;
  releasedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface SetLegalHoldInput {
  organisationId: string;
  resourceTable: string;
  rowId: string;
  reason: string;
  setBy: string;
  metadata?: Record<string, unknown>;
}

export interface ReleaseLegalHoldInput {
  organisationId: string;
  resourceTable: string;
  rowId: string;
  /** Idempotency: releasing an already-released hold returns ok with releasedAt unchanged. */
  releasedBy: string;
}

export interface LegalHoldRepository {
  listForTenant(organisationId: string): Promise<LegalHoldRecord[]>;
  listForTenantAsOperator(organisationId: string): Promise<LegalHoldRecord[]>;
  getActive(
    organisationId: string,
    resourceTable: string,
    rowId: string
  ): Promise<LegalHoldRecord | null>;
  /** Operator-only (rls_bypass). Idempotent on (org, table, rowId, state). Caller MUST audit first. */
  set(input: SetLegalHoldInput): Promise<LegalHoldRecord>;
  /** Operator-only (rls_bypass). Idempotent: returns the released record unchanged once released. Caller MUST audit first. */
  release(input: ReleaseLegalHoldInput): Promise<LegalHoldRecord>;
  /** Read-only check. */
  isActive(organisationId: string, resourceTable: string, rowId: string): Promise<boolean>;
}
