-- Migration 022: Tenant entitlements (ADR-0057 / ADR-0058 / ADR-ACT-0254)
--
-- Per-tenant entitlement grants — "what is this tenant allowed to use?".
-- System-operator managed; tenant read-only view. Absence of a 'granted' row
-- means the capability is unavailable (deny-by-default, ADR-0058).
--
-- RLS-enabled (ADR-0029 defence-in-depth, ADR-ACT-0189 platform_app non-superuser):
--   app.current_tenant_id is set by withTenant() for tenant self-reads;
--   operator reads/writes go via withSystemAdmin() (rls_bypass) and MUST emit audit.
--
-- Entitlements are NOT feature flags and NOT permissions (ADR-0058). Quota metadata
-- may be recorded here but quota ENFORCEMENT is Phase 2 (ADR-0057) — not delivered.

CREATE TABLE IF NOT EXISTS public.tenant_entitlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  entitlement_key TEXT        NOT NULL,
  state           TEXT        NOT NULL DEFAULT 'granted' CHECK (state IN ('granted', 'revoked')),
  source          TEXT        NOT NULL DEFAULT 'system'  CHECK (source IN ('system', 'migration', 'seed')),
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  UNIQUE (organisation_id, entitlement_key)
);

CREATE INDEX IF NOT EXISTS tenant_entitlements_org_idx
  ON public.tenant_entitlements (organisation_id);

ALTER TABLE public.tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_entitlements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.tenant_entitlements;
CREATE POLICY tenant_isolation ON public.tenant_entitlements
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );
