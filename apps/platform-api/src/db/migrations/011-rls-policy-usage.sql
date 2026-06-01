-- Migration 011: Correct RLS enforcement for platform_app non-superuser role (ADR-ACT-0189)
--
-- Problem: migration 010 creates platform_app with the default INHERIT attribute,
-- so pg_has_role(current_user, 'rls_bypass', 'MEMBER') is TRUE for every query
-- run as platform_app — making the RLS policies silently ineffective.
--
-- Fix:
--   1. ALTER ROLE platform_app NOINHERIT — role membership no longer implies
--      automatic privilege inheritance. platform_app can still SET LOCAL ROLE
--      rls_bypass (because it remains a MEMBER), but USAGE returns false while
--      running as platform_app outside an explicit SET ROLE block.
--
--   2. Grant DML to rls_bypass itself — after withSystemAdmin() does
--      SET LOCAL ROLE rls_bypass, current_user = rls_bypass. That role needs
--      SELECT/INSERT/UPDATE/DELETE to execute the actual queries.
--
--   3. Update all four RLS policies from MEMBER to USAGE — pg_has_role USAGE
--      returns true when privileges are currently active (INHERIT) rather than
--      merely when membership exists. This is the correct check:
--        - platform_app NOINHERIT outside SET ROLE: USAGE = false → RLS enforces ✓
--        - After SET LOCAL ROLE rls_bypass: current_user = rls_bypass → USAGE = true ✓
--        - pgadmin_sysadmin (INHERIT + rls_bypass granted): USAGE = true ✓
--        - platform superuser (FORCE RLS, has rls_bypass via INHERIT): USAGE = true ✓
--
-- withSystemAdmin() contract after this migration:
--   BEGIN; SET LOCAL ROLE rls_bypass; <work>; COMMIT;
--   SET LOCAL reverts automatically on transaction end — pool-safe.

-- ---------------------------------------------------------------------------
-- 1. Make platform_app NOINHERIT — don't auto-inherit rls_bypass privileges
-- ---------------------------------------------------------------------------
ALTER ROLE platform_app NOINHERIT;

-- ---------------------------------------------------------------------------
-- 2. Grant DML to rls_bypass (needed when current_user = rls_bypass after SET ROLE)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_bypass;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rls_bypass;

ALTER DEFAULT PRIVILEGES FOR ROLE platform IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rls_bypass;

ALTER DEFAULT PRIVILEGES FOR ROLE platform IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO rls_bypass;

-- ---------------------------------------------------------------------------
-- 3. Update RLS policies: MEMBER → USAGE
-- ---------------------------------------------------------------------------

-- memberships
DROP POLICY IF EXISTS tenant_isolation ON public.memberships;
CREATE POLICY tenant_isolation ON public.memberships
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'USAGE')
  );

-- tenant_resource_config
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_resource_config;
CREATE POLICY tenant_isolation ON public.tenant_resource_config
  USING (
    organisation_id::text = current_setting('app.current_tenant_id', true)
    OR pg_has_role(current_user, 'rls_bypass', 'USAGE')
  );

-- users
DROP POLICY IF EXISTS tenant_access ON public.users;
CREATE POLICY tenant_access ON public.users
  USING (
    pg_has_role(current_user, 'rls_bypass', 'USAGE')
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
    pg_has_role(current_user, 'rls_bypass', 'USAGE')
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = external_identities.user_id
        AND m.organisation_id::text = current_setting('app.current_tenant_id', true)
    )
    OR user_id::text = current_setting('app.current_user_id', true)
  );
