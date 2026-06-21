-- Migration 035: Legal hold (ADR-0064 / ADR-0063 / V1C-12c, ADR-ACT-0248)
--
-- Platform-wide legal hold flag (single owner per v1-completion-programme.md
-- §V1C-12c). Retention (V1C-12b) and Object Storage (V1C-15) consume — but
-- never own — the flag. When state='active', the held rows MUST survive
-- retention purges AND storage lifecycle deletion until state='released'.
--
-- Scope: any row referenced by (resource_table, row_id) under an active hold.
-- The runtime proof turns this on for a recording, then exercises both
-- retention and storage lifecycle deletion against it and asserts the record
-- still exists (the Sole-Owner invariant).
--
-- RLS (ADR-0029 defence-in-depth, ADR-ACT-0189 platform_app non-superuser):
--   app.current_tenant_id set by withTenant() for tenant self-reads;
--   operator reads/writes go via withSystemAdmin() (rls_bypass) and MUST emit
--   audit BEFORE the write at the use-case layer (audit-before-change).
--
-- Single UNIQUE constraint per (org, table, rowId, state) yields idempotent
-- set when state='active' (ON CONFLICT DO UPDATE preserves the original set_at
-- and id) and idempotent release when state='released' (UPDATE no-ops once
-- already released).

CREATE TABLE IF NOT EXISTS public.legal_holds (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  resource_table  TEXT        NOT NULL,
  row_id          TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  state           TEXT        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'released')),
  set_by          TEXT        NOT NULL,
  released_by     TEXT,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id, resource_table, row_id, state)
);

CREATE INDEX IF NOT EXISTS legal_holds_org_idx
  ON public.legal_holds (organisation_id);

CREATE INDEX IF NOT EXISTS legal_holds_resource_idx
  ON public.legal_holds (resource_table, row_id);

CREATE INDEX IF NOT EXISTS legal_holds_active_idx
  ON public.legal_holds (state) WHERE state = 'active';

ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_holds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_hold_tenant_isolation ON public.legal_holds;
CREATE POLICY legal_hold_tenant_isolation ON public.legal_holds
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );
