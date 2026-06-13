-- Migration 023: Correct the tenant_entitlements RLS bypass predicate (ADR-ACT-0255).
--
-- Migration 022 created the tenant_entitlements RLS policy with the naive predicate
--   organisation_id::text = current_setting('app.current_tenant_id', true)
--   OR pg_has_role(current_user, 'rls_bypass', 'MEMBER')
-- which is the SAME latent flaw migration 012 fixed for the other tenant tables:
-- pg_has_role(..., 'MEMBER') is TRUE for platform_app (a NOINHERIT *member* of
-- rls_bypass), so the bypass clause was always true and RLS did NOT isolate
-- platform_app under withTenant(). The live proof (proof:entitlements-postgres)
-- caught this: an unfiltered count under another tenant's context returned > 0.
--
-- This migration replaces the policy with the canonical current_user + rolinherit
-- predicate (identical to migration 012):
--   1. current_user = 'rls_bypass'  → only AFTER withSystemAdmin() does SET LOCAL ROLE.
--   2. pg_has_role(current_user, 'rls_bypass', 'MEMBER') AND rolinherit(current_user)
--      → for roles that inherit rls_bypass (pgadmin_sysadmin, superuser).
-- platform_app is NOINHERIT, so under withTenant() (no SET ROLE) the bypass is false
-- and RLS enforces tenant isolation. withSystemAdmin() (SET LOCAL ROLE rls_bypass)
-- still bypasses correctly.

DROP POLICY IF EXISTS tenant_isolation ON public.tenant_entitlements;
CREATE POLICY tenant_isolation ON public.tenant_entitlements
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
