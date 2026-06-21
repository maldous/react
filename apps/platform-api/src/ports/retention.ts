// ---------------------------------------------------------------------------
// Retention port (ADR-0064 / V1C-12b, decisionRef V1C-12b).
//
// CONSUMES — never owns — the legal-hold flag (V1C-12c). The retention tick
// fetches candidate rows whose age exceeds the policy's ttl_seconds, then for
// each:
//   1. audit-before-delete emit (RetentionApplied) — establishes "about to delete"
//   2. LegalHoldGuard.assertCanDelete(org, table, rowId) — fails-closed on hold
//   3. outcome='deleted' (proceed) | outcome='skipped_legal_hold' (preserve)
//
// Policy set / remove is audited before the DB write (audit-before-change).
//
// Filter: the JSONB eligibility filter is a strict whitelist of column-based
// predicates. Free-form WHERE strings would be a SQL-injection vector and are
// rejected at the use-case boundary (validateFilter).
// ---------------------------------------------------------------------------

export type RetentionAction = "delete";
export type RetentionCandidateOutcome =
  | "pending"
  | "deleted"
  | "skipped_legal_hold"
  | "skipped_filtered"
  | "skipped_expired";

export type RetentionFilter = { kind: "all" } | { kind: "by_status"; statuses: readonly string[] };

export interface RetentionPolicyRecord {
  id: string;
  organisationId: string;
  resourceTable: string;
  ttlSeconds: number;
  filter: RetentionFilter;
  enabled: boolean;
  setBy: string;
  setAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface UpsertRetentionPolicyInput {
  organisationId: string;
  resourceTable: string;
  ttlSeconds: number;
  filter: RetentionFilter;
  setBy: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RetentionCandidateRecord {
  id: string;
  organisationId: string;
  resourceTable: string;
  rowId: string;
  policyId: string;
  outcome: RetentionCandidateOutcome;
  evaluatedAt: string | null;
  deletedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CandidateRow {
  resourceTable: string;
  rowId: string;
  ageSeconds: number;
}

export interface RetentionRepository {
  listPoliciesForTenant(organisationId: string): Promise<RetentionPolicyRecord[]>;
  listPoliciesAsOperator(organisationId: string): Promise<RetentionPolicyRecord[]>;
  getEnabledPolicy(
    organisationId: string,
    resourceTable: string
  ): Promise<RetentionPolicyRecord | null>;
  /** Operator-only (rls_bypass). Idempotent: a unique constraint is enforced on
   * (org, table, enabled=TRUE) so re-setting produces the original record. */
  upsertPolicy(input: UpsertRetentionPolicyInput): Promise<RetentionPolicyRecord>;
  /** Operator-only (rls_bypass). Logic-delete: sets enabled=FALSE and stamps updated_at. */
  disablePolicy(
    organisationId: string,
    resourceTable: string
  ): Promise<RetentionPolicyRecord | null>;
  /** Returns the candidate rows for a policy whose age >= ttl. Operator-only. */
  selectCandidates(policy: RetentionPolicyRecord, limit: number): Promise<CandidateRow[]>;
  /** Records an outcome on (policy, table, rowId) — idempotent across tick re-runs. */
  recordOutcome(input: {
    organisationId: string;
    policyId: string;
    resourceTable: string;
    rowId: string;
    outcome: RetentionCandidateOutcome;
  }): Promise<void>;
  /** Returns the per-policy ledger for a tick observability surface. */
  listCandidatesForPolicy(
    policyId: string,
    outcome?: RetentionCandidateOutcome
  ): Promise<RetentionCandidateRecord[]>;
}
