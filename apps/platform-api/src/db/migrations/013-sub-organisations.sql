-- Migration 013: Sub-organisation support (ADR-ACT-0143 Slice 3)
--
-- Sub-organisations are Tier 2 tenants: they share the parent's Keycloak realm
-- and Postgres schema (no new realm/schema provisioned). They are recorded in
-- public.organisations with a non-null parent_id.
--
-- Constraints:
--   - parent_id must point to a top-level org (parent_id IS NULL) — no multi-level
--   - is_active defaults to true; deactivation is a soft-delete
--   - A top-level org cannot be converted to a sub-org after creation
--   - Slugs must be globally unique (existing UNIQUE constraint on slug covers this)
--
-- Isolation: organisations has no RLS (by design, migration 006). Sub-org
-- filtering is application-level: all queries use WHERE parent_id = $parentOrgId.

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.organisations(id)
    ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Sub-org's parent must itself be a top-level org (no multi-level nesting).
-- NOTE: CHECK constraints referencing other rows are not enforced by PostgreSQL
-- in the standard way. We enforce single-level nesting at the application layer
-- in createSubOrg (checking parentOrg.parent_id IS NULL before insert).
-- The constraint below guards the data invariant via a function check.
CREATE OR REPLACE FUNCTION check_suborg_parent_toplevel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.organisations
      WHERE id = NEW.parent_id AND parent_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'sub-org parent must be a top-level organisation (parent_id IS NULL)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suborg_parent_toplevel_check ON public.organisations;
CREATE TRIGGER suborg_parent_toplevel_check
  BEFORE INSERT OR UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION check_suborg_parent_toplevel();

-- Index for efficient listing of sub-orgs by parent
CREATE INDEX IF NOT EXISTS organisations_parent_id_idx
  ON public.organisations (parent_id)
  WHERE parent_id IS NOT NULL;
