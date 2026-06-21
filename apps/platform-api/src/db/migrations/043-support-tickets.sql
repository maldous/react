-- Migration 043: support tickets + tenant lifecycle soft-state
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_tickets_org_created_idx
  ON public.support_tickets (organisation_id, created_at DESC);

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
