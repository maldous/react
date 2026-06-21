-- Migration 040: tenant data residency tagging (V1C-12d)
--
-- Residency is owned by the tenant row on public.organisations. A null tag means
-- "not yet set". Placement enforcement is fail-closed in provisioning and storage
-- boundary checks, not inferred from provider defaults.

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS residency_tag TEXT;

ALTER TABLE public.organisations
  ADD CONSTRAINT organisations_residency_tag_format_chk
  CHECK (residency_tag IS NULL OR residency_tag ~ '^[a-z]{2}(?:-[a-z0-9]+)*$');
