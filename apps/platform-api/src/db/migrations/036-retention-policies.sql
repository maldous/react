-- Migration 036: Retention (ADR-0064 / ADR-0063 / V1C-12b, ADR-ACT-0248)
--
-- Platform-wide retention policy engine: defines WHAT is purged WHEN, and
-- records each candidate + applied/delete outcome for tick observability.
--
-- The sole consumer of LegalHoldGuard (V1C-12c). A retention tick that proposes
-- a candidate purge MUST first call LegalHoldGuard.assertCanDelete(org, table,
-- rowId); held rows are recorded as state='skipped_legal_hold' (audit-before-
-- change) and never deleted. Retained audit-before-change shape.
--
-- Two tables:
--   - public.retention_policies     : per-tenant policy definitions (cron tick
--                                     interval, eligibility filter, ttl).
--   - public.retention_candidates  : per-tick ledger recording each candidate's
--                                     outcome (deleted / skipped_legal_hold /
--                                     skipped_expired / skipped_filtered).
--
-- RLS consistent with the rest of the platform (ADR-0029 defence-in-depth,
-- ADR-ACT-0189 platform_app non-superuser). Tenant self-read via withTenant();
-- operator reads/writes via withSystemAdmin() (rls_bypass) and are audited at
-- the use-case layer.

CREATE TABLE IF NOT EXISTS public.retention_policies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  resource_table  TEXT        NOT NULL,
  ttl_seconds     INTEGER     NOT NULL CHECK (ttl_seconds > 0),
  -- Eligibility filter: a JSONB predicate evaluated at candidate selection time.
  -- MUST be a strict whitelist keyed on row columns; free-form WHERE strings are
  -- rejected at the use-case boundary (catastrophic SQL-injection vector).
  -- Examples:
  --   { "kind": "all" }
  --   { "kind": "by_status", "statuses": ["invited","disabled"] }
  filter          JSONB       NOT NULL DEFAULT '{"kind":"all"}'::jsonb,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  set_by          TEXT        NOT NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Partial uniqueness invariant: only ONE enabled policy per (organisation_id,
-- resource_table). PostgreSQL Does NOT allow a WHERE clause on table-level
-- UNIQUE constraints, so we project the invariant onto a CREATE UNIQUE INDEX
-- ... WHERE statement (V1C-12b / ADR-0064; required by upsertPolicy in
-- adapters/postgres-retention.ts which soft-disables the prior enabled row
-- before inserting the replacement — historical audit trail preserved).
CREATE UNIQUE INDEX IF NOT EXISTS retention_policies_unique_enabled_idx
  ON public.retention_policies (organisation_id, resource_table)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS retention_policies_org_idx
  ON public.retention_policies (organisation_id);

CREATE INDEX IF NOT EXISTS retention_policies_resource_idx
  ON public.retention_policies (resource_table) WHERE enabled = TRUE;

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS retention_policy_tenant_isolation ON public.retention_policies;
CREATE POLICY retention_policy_tenant_isolation ON public.retention_policies
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );

CREATE TABLE IF NOT EXISTS public.retention_candidates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  resource_table  TEXT        NOT NULL,
  row_id          TEXT        NOT NULL,
  policy_id       UUID        NOT NULL REFERENCES public.retention_policies(id) ON DELETE CASCADE,
  -- Outcome of the tick's evaluation of this row. Final outcomes write to
  -- audit-events (audit-before-delete) then mutate or skip the target row.
  outcome         TEXT        NOT NULL DEFAULT 'pending' CHECK (
                    outcome IN (
                      'pending', 'deleted', 'skipped_legal_hold',
                      'skipped_filtered', 'skipped_expired'
                    )
                  ),
  evaluated_at    TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (policy_id, resource_table, row_id)
);

CREATE INDEX IF NOT EXISTS retention_candidates_policy_idx
  ON public.retention_candidates (policy_id);

CREATE INDEX IF NOT EXISTS retention_candidates_outcome_idx
  ON public.retention_candidates (outcome) WHERE outcome = 'pending';

ALTER TABLE public.retention_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_candidates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS retention_candidate_tenant_isolation ON public.retention_candidates;
CREATE POLICY retention_candidate_tenant_isolation ON public.retention_candidates
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );
