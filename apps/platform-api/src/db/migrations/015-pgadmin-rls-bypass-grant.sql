-- Migration 015: Idempotent grant of rls_bypass to pgadmin_sysadmin (ADR-ACT-0184)
--
-- The init-extra-databases.sh Docker entrypoint script grants rls_bypass to
-- pgadmin_sysadmin at container creation. For databases created before this grant
-- was added (or where the entrypoint script ran with the role already present), the
-- grant is missing and the compose-smoke regression guard fails.
--
-- This migration applies the grant idempotently so all existing environments are
-- brought into the expected state on the next db:migrate run.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pgadmin_sysadmin')
     AND EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rls_bypass')
     AND NOT pg_has_role('pgadmin_sysadmin', 'rls_bypass', 'MEMBER') THEN
    GRANT rls_bypass TO pgadmin_sysadmin;
  END IF;
END
$$;
