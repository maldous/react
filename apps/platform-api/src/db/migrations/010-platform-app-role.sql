-- Migration 010: platform_app non-superuser application role (ADR-ACT-0189)
--
-- Rationale: the application has historically connected as POSTGRES_USER (a
-- superuser). Superusers bypass Row-Level Security unconditionally, so RLS
-- policies on memberships/users/external_identities/tenant_resource_config
-- were never enforced at runtime. This migration creates a dedicated LOGIN
-- role that is subject to RLS, reducing the attack surface for IDOR bugs.
--
-- Key properties of platform_app:
--   NOSUPERUSER   — RLS applies; no server-level admin privileges
--   NOBYPASSRLS   — explicit; cannot bypass RLS even with FORCE ROW LEVEL SECURITY
--   LOGIN         — can authenticate (needs a connection URL)
--
-- withSystemAdmin() continues to work: platform_app is granted the rls_bypass
-- NOLOGIN role, so pg_has_role(current_user, 'rls_bypass', 'MEMBER') = true,
-- and the RLS bypass policies allow cross-tenant reads when needed.
--
-- IMPORTANT: The role password is NOT hardcoded here. The ${PLATFORM_APP_PASSWORD}
-- placeholder is substituted at apply-time by the migration runner (migrate.ts)
-- with the password from POSTGRES_APP_URL (managed env, ADR-0072 / OpenBao-backed
-- secret material, ADR-0069), so the role password always matches the app
-- connection string. Production sets POSTGRES_APP_URL to a strong managed value.

-- ---------------------------------------------------------------------------
-- 1. Ensure rls_bypass exists (migration 008 creates it; idempotent guard)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rls_bypass') THEN
    CREATE ROLE rls_bypass NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Create platform_app role (idempotent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'platform_app') THEN
    CREATE ROLE platform_app
      LOGIN
      PASSWORD '${PLATFORM_APP_PASSWORD}'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Grant rls_bypass membership so withSystemAdmin() works for platform_app
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT pg_has_role('platform_app', 'rls_bypass', 'MEMBER') THEN
    GRANT rls_bypass TO platform_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Schema and database access
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE platform TO platform_app;
GRANT USAGE ON SCHEMA public TO platform_app;

-- ---------------------------------------------------------------------------
-- 5. Privileges on all existing tables and sequences
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO platform_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO platform_app;

-- ---------------------------------------------------------------------------
-- 6. Default privileges for tables/sequences created by future migrations
--    (run as POSTGRES_USER = 'platform', the migration author)
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE platform IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app;

ALTER DEFAULT PRIVILEGES FOR ROLE platform IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO platform_app;
