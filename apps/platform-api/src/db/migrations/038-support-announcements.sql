-- Migration 038: Support announcements (ADR-ACT-0251 slice)
--
-- Minimal durable announcement log for tenant-scoped support comms. This is
-- intentionally small: a created/published announcement with an audited actor
-- and a tenant target. Delivery is handled by the notification substrate.

CREATE TABLE IF NOT EXISTS public.support_announcements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject         TEXT        NOT NULL,
  message         TEXT        NOT NULL,
  created_by      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_announcements_org_created_idx
  ON public.support_announcements (organisation_id, created_at DESC);

ALTER TABLE public.support_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_announcements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_announcements_tenant_isolation ON public.support_announcements;
CREATE POLICY support_announcements_tenant_isolation ON public.support_announcements
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );
