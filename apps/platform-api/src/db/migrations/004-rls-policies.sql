-- Migration 004: Row-Level Security on global tenant boundary tables
--
-- Adds RLS to public-schema tables that scope data by tenant or user.
-- ADR-0029 ?3c: RLS is defence-in-depth within each tenant schema.
-- ADR-0031: application DB user must not be superuser (superusers bypass RLS).
--
-- SET LOCAL app.current_user_id and app.bypass_rls are set by the adapter
-- layer (withTenant, withSystemAdmin) per-transaction. All policies fall
-- through to DENY when the session variable is not set.

-- ---------------------------------------------------------------------------
-- organisations: a session can only see its own organisation row
-- ---------------------------------------------------------------------------

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.organisations;
CREATE POLICY tenant_isolation ON public.organisations
  USING (
    id::text = current_setting('app.current_tenant_id', true)
    OR current_setting('app.bypass_rls', true)::boolean IS TRUE
  );

-- ---------------------------------------------------------------------------
-- memberships: visible only within the current tenant
-- ---------------------------------------------------------------------------

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.memberships;
CREATE POLICY tenant_isolation ON public.memberships
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR current_setting('app.bypass_rls', true)::boolean IS TRUE
  );

-- ---------------------------------------------------------------------------
-- tenant_resource_config: visible only for the owning organisation
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenant_resource_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_resource_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.tenant_resource_config;
CREATE POLICY tenant_isolation ON public.tenant_resource_config
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR current_setting('app.bypass_rls', true)::boolean IS TRUE
  );

-- ---------------------------------------------------------------------------
-- users: cross-tenant (users can belong to multiple orgs).
-- Accessible when: the user is part of the current tenant (via membership),
-- or system-admin bypass is active.
-- ---------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_access ON public.users;
CREATE POLICY tenant_access ON public.users
  USING (
    current_setting('app.bypass_rls', true)::boolean IS TRUE
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = users.id
        AND m.organisation_id::text = current_setting('app.current_tenant_id', true)
    )
    -- Allow a user to always see their own record (for profile operations)
    OR id::text = current_setting('app.current_user_id', true)
  );

-- external_identities: same access rules as users
ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_identities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_access ON public.external_identities;
CREATE POLICY tenant_access ON public.external_identities
  USING (
    current_setting('app.bypass_rls', true)::boolean IS TRUE
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = external_identities.user_id
        AND m.organisation_id::text = current_setting('app.current_tenant_id', true)
    )
    OR user_id::text = current_setting('app.current_user_id', true)
  );
