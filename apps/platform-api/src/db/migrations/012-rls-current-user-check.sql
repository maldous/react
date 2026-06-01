-- Migration 012: Correct RLS bypass predicate — current_user + rolinherit check
--
-- Problem: migration 011 changed the bypass predicate to pg_has_role(..., 'USAGE'),
-- but PostgreSQL's pg_has_role USAGE returns true for platform_app even with
-- NOINHERIT set — USAGE and MEMBER are equivalent for role-membership checks.
-- Neither flag distinguishes "connected as platform_app" from "connected as rls_bypass
-- after SET LOCAL ROLE rls_bypass".
--
-- The correct predicate combines two cases:
--
--   1. current_user = 'rls_bypass'
--      True only AFTER withSystemAdmin() does SET LOCAL ROLE rls_bypass inside a
--      transaction. In this case current_user changes from 'platform_app' to
--      'rls_bypass' for the transaction lifetime. After COMMIT or ROLLBACK, the
--      role reverts automatically (SET LOCAL is transaction-scoped).
--
--   2. pg_has_role(current_user, 'rls_bypass', 'MEMBER')
--      AND (SELECT rolinherit FROM pg_roles WHERE rolname = current_user LIMIT 1)
--      True for roles that INHERIT rls_bypass privileges automatically (e.g.,
--      pgadmin_sysadmin, platform superuser). These do not need SET LOCAL ROLE.
--
-- Behaviour by role:
--   platform_app (NOINHERIT, rls_bypass member):
--     current_user ≠ 'rls_bypass', rolinherit = false  → bypass = false ✓ (RLS enforces)
--
--   rls_bypass (after SET LOCAL ROLE in withSystemAdmin):
--     current_user = 'rls_bypass'                      → bypass = true  ✓
--
--   pgadmin_sysadmin (INHERIT, rls_bypass member):
--     pg_has_role = true, rolinherit = true              → bypass = true  ✓
--
--   platform (superuser, INHERIT, rls_bypass member):
--     pg_has_role = true, rolinherit = true              → bypass = true  ✓

-- ---------------------------------------------------------------------------
-- Updated RLS policies
-- ---------------------------------------------------------------------------

-- memberships
DROP POLICY IF EXISTS tenant_isolation ON public.memberships;
CREATE POLICY tenant_isolation ON public.memberships
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
  );

-- tenant_resource_config
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_resource_config;
CREATE POLICY tenant_isolation ON public.tenant_resource_config
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
  );

-- users
DROP POLICY IF EXISTS tenant_access ON public.users;
CREATE POLICY tenant_access ON public.users
  USING (
    (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
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
    (
      current_user::text = 'rls_bypass'
      OR (
        pg_has_role(current_user, 'rls_bypass', 'MEMBER')
        AND COALESCE(
          (SELECT rolinherit FROM pg_roles WHERE rolname = current_user::text LIMIT 1),
          false
        )
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = external_identities.user_id
        AND m.organisation_id::text = current_setting('app.current_tenant_id', true)
    )
    OR user_id::text = current_setting('app.current_user_id', true)
  );
