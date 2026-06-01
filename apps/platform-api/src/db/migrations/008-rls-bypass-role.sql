-- Migration 008: Replace GUC-based RLS bypass with role-membership check (ADR-ACT-0184)
--
-- The previous approach (app.bypass_rls custom GUC) was user-settable: any connection
-- holder, including a pgAdmin user with arbitrary SQL access, could execute
--   SET app.bypass_rls = 'true';
-- to bypass Row-Level Security and read cross-tenant data.
--
-- This migration replaces it with pg_has_role(current_user, 'rls_bypass', 'MEMBER'),
-- which is controlled by PostgreSQL role membership — not a session variable — and
-- cannot be changed by an unprivileged connection.
--
-- Only the following tables retain RLS (organisations had it removed in migration 006):
--   memberships, tenant_resource_config, users, external_identities
--
-- IMPORTANT: pg_has_role(current_user, 'rls_bypass', 'MEMBER') raises an ERROR if the
-- 'rls_bypass' role does not exist. The role must be created BEFORE the policies.

-- ---------------------------------------------------------------------------
-- 1. Create the rls_bypass NOLOGIN role (idempotent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rls_bypass') THEN
    CREATE ROLE rls_bypass NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Grant rls_bypass to the application DB user (the user running migrations).
--    This preserves withSystemAdmin() semantics: the app can still bypass RLS
--    for privileged cross-tenant operations via role membership rather than a GUC.
--
--    NOTE: in local dev the app user is typically a superuser (which bypasses RLS
--    unconditionally). This grant is load-bearing only when the app runs as a
--    non-superuser in production — see ADR-0031 and ADR-ACT-0153.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'rls_bypass', 'MEMBER') THEN
    EXECUTE format('GRANT rls_bypass TO %I', current_user);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Update RLS policies to use role-membership check
-- ---------------------------------------------------------------------------

-- memberships
DROP POLICY IF EXISTS tenant_isolation ON public.memberships;
CREATE POLICY tenant_isolation ON public.memberships
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );

-- tenant_resource_config
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_resource_config;
CREATE POLICY tenant_isolation ON public.tenant_resource_config
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
  );

-- users
DROP POLICY IF EXISTS tenant_access ON public.users;
CREATE POLICY tenant_access ON public.users
  USING (
    pg_has_role(current_user, 'rls_bypass', 'MEMBER')
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = users.id
        AND m.organisation_id::text = current_setting('app.current_tenant_id', true)
    )
    OR id::text = current_setting('app.current_user_id', true)
  );

-- external_identities
DROP POLICY IF EXISTS tenant_access ON public.external_identities;
CREATE POLICY tenant_access ON public.external_identities
  USING (
    pg_has_role(current_user, 'rls_bypass', 'MEMBER')
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = external_identities.user_id
        AND m.organisation_id::text = current_setting('app.current_tenant_id', true)
    )
    OR user_id::text = current_setting('app.current_user_id', true)
  );
