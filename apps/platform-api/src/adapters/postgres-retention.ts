/**
 * PostgresRetentionRepository (ADR-0064 / V1C-12b).
 *
 * CONSUMER of LegalHoldGuard (V1C-12c, sole owner). Never makes retention
 * decisions about whether to delete — the use-case delegates to
 * LegalHoldGuard.assertCanDelete on every candidate row.
 *
 * Backed by public.retention_policies + public.retention_candidates
 * (migration 036), both RLS-enabled. Tenant self-read via withTenant();
 * operator reads/writes via withSystemAdmin() (rls_bypass) and MUST emit audit
 * before any deletion (audit-before-change).
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  CandidateRow,
  RetentionCandidateOutcome,
  RetentionCandidateRecord,
  RetentionPolicyRecord,
  RetentionRepository,
  RetentionFilter,
  UpsertRetentionPolicyInput,
} from "../ports/retention.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

interface PolicyRow {
  id: string;
  organisation_id: string;
  resource_table: string;
  ttl_seconds: number;
  filter: RetentionFilter;
  enabled: boolean;
  set_by: string;
  set_at: string;
  updated_by: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface CandidateLedgerRow {
  id: string;
  organisation_id: string;
  resource_table: string;
  row_id: string;
  policy_id: string;
  outcome: RetentionCandidateOutcome;
  evaluated_at: string | null;
  deleted_at: string | null;
  metadata: Record<string, unknown> | null;
}

function toPolicy(row: PolicyRow): RetentionPolicyRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    resourceTable: row.resource_table,
    ttlSeconds: row.ttl_seconds,
    filter: row.filter,
    enabled: row.enabled,
    setBy: row.set_by,
    setAt: row.set_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    metadata: row.metadata ?? {},
  };
}

function toCandidate(row: CandidateLedgerRow): RetentionCandidateRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    resourceTable: row.resource_table,
    rowId: row.row_id,
    policyId: row.policy_id,
    outcome: row.outcome,
    evaluatedAt: row.evaluated_at,
    deletedAt: row.deleted_at,
    metadata: row.metadata ?? {},
  };
}

const POLICY_COLS =
  "id, organisation_id, resource_table, ttl_seconds, filter, enabled, set_by, set_at, updated_by, updated_at, metadata";
const CANDIDATE_COLS =
  "id, organisation_id, resource_table, row_id, policy_id, outcome, evaluated_at, deleted_at, metadata";

// Retention currently only targets tables that have a created_at column and we
// own. The list is small + bounded; expand as new retention surfaces are added.
const SELECTABLE_TABLES = ["audit_events", "tenant_invitations"] as const;
type SelectableTable = (typeof SELECTABLE_TABLES)[number];

function isSelectable(t: string): t is SelectableTable {
  return (SELECTABLE_TABLES as readonly string[]).includes(t);
}

export class PostgresRetentionRepository implements RetentionRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listPoliciesForTenant(organisationId: string): Promise<RetentionPolicyRecord[]> {
    const rows = await withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query<PolicyRow>(
        `SELECT ${POLICY_COLS} FROM public.retention_policies WHERE organisation_id = $1 ORDER BY resource_table`,
        [organisationId]
      );
      return r.rows;
    });
    return rows.map(toPolicy);
  }

  async listPoliciesAsOperator(organisationId: string): Promise<RetentionPolicyRecord[]> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<PolicyRow>(
        `SELECT ${POLICY_COLS} FROM public.retention_policies WHERE organisation_id = $1 ORDER BY resource_table`,
        [organisationId]
      );
      return r.rows;
    });
    return rows.map(toPolicy);
  }

  async getEnabledPolicy(
    organisationId: string,
    resourceTable: string
  ): Promise<RetentionPolicyRecord | null> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<PolicyRow>(
        `SELECT ${POLICY_COLS} FROM public.retention_policies
         WHERE organisation_id = $1 AND resource_table = $2 AND enabled = TRUE LIMIT 1`,
        [organisationId, resourceTable]
      );
      return r.rows;
    });
    return rows.length ? toPolicy(rows[0]!) : null;
  }

  async upsertPolicy(input: UpsertRetentionPolicyInput): Promise<RetentionPolicyRecord> {
    const filter = JSON.stringify(input.filter);
    const metadata = JSON.stringify(input.metadata ?? {});
    // Idempotency pattern (mirrors V1C-12c legal hold): every policy set first
    // disables any prior enabled policy for the same (org, table) so the partial
    // unique index (org, table, enabled) where enabled=TRUE never has conflicts.
    // The returned row IS the canonical active policy.
    const existing = await this.getEnabledPolicy(input.organisationId, input.resourceTable);
    if (existing) {
      // ON CONFLICT-free upsert via INSERT ... RETURNING after disabling.
      await withSystemAdmin(this.pool as never, async (client) => {
        await client.query(
          `UPDATE public.retention_policies SET enabled = FALSE, updated_at = now(), updated_by = $2
           WHERE organisation_id = $1 AND resource_table = $3 AND enabled = TRUE`,
          [input.organisationId, input.setBy, input.resourceTable]
        );
      });
    }
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<PolicyRow>(
        `INSERT INTO public.retention_policies
           (organisation_id, resource_table, ttl_seconds, filter, enabled, set_by, metadata)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
         RETURNING ${POLICY_COLS}`,
        [
          input.organisationId,
          input.resourceTable,
          input.ttlSeconds,
          filter,
          input.enabled ?? true,
          input.setBy,
          metadata,
        ]
      );
      return r.rows;
    });
    return toPolicy(rows[0]!);
  }

  async disablePolicy(
    organisationId: string,
    resourceTable: string
  ): Promise<RetentionPolicyRecord | null> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<PolicyRow>(
        `UPDATE public.retention_policies
         SET enabled = FALSE, updated_at = now(), updated_by = 'operator'
         WHERE organisation_id = $1 AND resource_table = $2 AND enabled = TRUE
         RETURNING ${POLICY_COLS}`,
        [organisationId, resourceTable]
      );
      return r.rows;
    });
    return rows.length ? toPolicy(rows[0]!) : null;
  }

  async selectCandidates(policy: RetentionPolicyRecord, limit: number): Promise<CandidateRow[]> {
    if (!isSelectable(policy.resourceTable)) return [];
    return withSystemAdmin(this.pool as never, async (client) => {
      let where = `organisation_id = $1 AND created_at < now() - ($2 || ' seconds')::interval`;
      const params: unknown[] = [policy.organisationId, policy.ttlSeconds];
      if (policy.filter.kind === "by_status") {
        const statuses = policy.filter.statuses;
        if (!Array.isArray(statuses) || statuses.length === 0) return [];
        where += ` AND status = ANY($${params.length + 1}::text[])`;
        params.push(statuses);
      } else if (policy.filter.kind !== "all") {
        return [];
      }
      const r = await client.query<{ id: string; created_at: string }>(
        `SELECT id, created_at FROM public.${policy.resourceTable}
         WHERE ${where}
         ORDER BY created_at
         LIMIT ${Math.min(Math.max(limit, 1), 1000)}`,
        params
      );
      return r.rows.map((row) => {
        // Use schema-validated identifier (withTenant / platform_app does not have
        // an escapeIdentifier helper in this slice; we restrict table names to a
        // bounded SELECTABLE_TABLES list — structurally safe because all values are
        // a controlled string union at the use-case boundary).
        const ageMs = Date.now() - new Date(row.created_at).getTime();
        return {
          resourceTable: policy.resourceTable,
          rowId: row.id,
          ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
        };
      });
    });
  }

  async recordOutcome(input: {
    organisationId: string;
    policyId: string;
    resourceTable: string;
    rowId: string;
    outcome: RetentionCandidateOutcome;
  }): Promise<void> {
    await withSystemAdmin(this.pool as never, async (client) => {
      const evaluatedAt = input.outcome === "pending" ? null : new Date().toISOString();
      const deletedAt = input.outcome === "deleted" ? new Date().toISOString() : null;
      await client.query(
        `INSERT INTO public.retention_candidates
           (organisation_id, resource_table, row_id, policy_id, outcome, evaluated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
         ON CONFLICT (policy_id, resource_table, row_id)
         DO UPDATE SET outcome = EXCLUDED.outcome,
                       evaluated_at = EXCLUDED.evaluated_at,
                       deleted_at = EXCLUDED.deleted_at`,
        [
          input.organisationId,
          input.resourceTable,
          input.rowId,
          input.policyId,
          input.outcome,
          evaluatedAt,
          deletedAt,
        ]
      );
    });
  }

  async listCandidatesForPolicy(
    policyId: string,
    outcome?: RetentionCandidateOutcome
  ): Promise<RetentionCandidateRecord[]> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      if (outcome) {
        const r = await client.query<CandidateLedgerRow>(
          `SELECT ${CANDIDATE_COLS} FROM public.retention_candidates
           WHERE policy_id = $1 AND outcome = $2
           ORDER BY evaluated_at DESC NULLS LAST`,
          [policyId, outcome]
        );
        return r.rows;
      }
      const r = await client.query<CandidateLedgerRow>(
        `SELECT ${CANDIDATE_COLS} FROM public.retention_candidates
         WHERE policy_id = $1
         ORDER BY evaluated_at DESC NULLS LAST`,
        [policyId]
      );
      return r.rows;
    });
    return rows.map(toCandidate);
  }
}
