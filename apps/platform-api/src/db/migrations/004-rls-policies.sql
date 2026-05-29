-- Migration 004: Row-Level Security on data-boundary tables
--
-- ADR-0029 §3c: RLS is defence-in-depth for data tables that scope per tenant or user.
-- ADR-0031: the app DB user must NOT be a PostgreSQL superuser in production;
--           superusers bypass RLS even with FORCE ROW LEVEL SECURITY.
--           The Docker Compose dev setup uses POSTGRES_USER=platform which is a
--           superuser — RLS is structurally correct but not enforced in dev.
--           Production deployment must use a non-superuser role (ADR-ACT-0153).
--
-- Context variables (SET LOCAL per-transaction by adapters-postgres helpers):
--   app.current_tenant_id  — set by withTenant()
--   app.current_user_id    — set by withTenantActor()
--   app.bypass_rls         — set by withSystemAdmin()
--
-- public.organisations is intentionally EXCLUDED from RLS.
-- Rationale: slug→id lookups happen before any session exists (FQDN routing,
-- forward_auth). Adding RLS here would require withSystemAdmin on every
-- request — routing is not sensitive data, schema-per-tenant already
-- provides the meaningful isolation boundary. ADR-0029 §1a.

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
-- users: cross-tenant global identity table.
-- Accessible when:
--   - system-admin bypass is active (provisioning, auth system)
--   - the user belongs to the current tenant (via membership)
--   - the record IS the current user (own-profile access)
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
