#!/bin/bash
# Create additional databases for SonarQube and Sentry in the shared Postgres instance.
set -e

POSTGRES_USER="${POSTGRES_USER:-platform}"

create_db_and_user() {
  local db="$1"
  local user="$2"
  local pass="$3"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${user}') THEN
    CREATE ROLE "${user}" LOGIN PASSWORD '${pass}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE "${db}" OWNER "${user}"'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')
\gexec
EOSQL
}

SONAR_DB_USER="${SONAR_DB_USER:-sonar}"
SONAR_DB_PASSWORD="${SONAR_DB_PASSWORD:-sonarpassword}"
SONAR_DB_NAME="${SONAR_DB_NAME:-sonar}"

SENTRY_DB_USER="${SENTRY_DB_USER:-sentry}"
SENTRY_DB_PASSWORD="${SENTRY_DB_PASSWORD:-sentrypassword}"
SENTRY_DB_NAME="${SENTRY_DB_NAME:-sentry}"

create_db_and_user "$SONAR_DB_NAME" "$SONAR_DB_USER" "$SONAR_DB_PASSWORD"
create_db_and_user "$SENTRY_DB_NAME" "$SENTRY_DB_USER" "$SENTRY_DB_PASSWORD"

# ---------------------------------------------------------------------------
# pgadmin_sysadmin — RLS-aware pgAdmin connection role (ADR-0029, ADR-0031)
#
# Superusers bypass ALL row security (even FORCE ROW LEVEL SECURITY). To make
# pgAdmin honour the same RLS behaviour as the application's withSystemAdmin():
#   - This role is NOT a superuser (so RLS applies to it)
#   - app.bypass_rls = 'true' is set as a session default (same flag the app
#     sets in withSystemAdmin) — sysadmin sees all tenant data, RLS enforced
#   - For tenant-scoped queries in the pgAdmin query tool, manually run:
#       SELECT set_config('app.current_tenant_id', '<org-id>', true);
# ---------------------------------------------------------------------------

PGADMIN_DB="${POSTGRES_DB:-platform}"
PGADMIN_SYSADMIN_ROLE="pgadmin_sysadmin"
PGADMIN_SYSADMIN_PASS="${PGADMIN_DB_PASSWORD:-pgadmin-sysadmin-password}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$PGADMIN_DB" <<EOSQL
-- rls_bypass: NOLOGIN role that controls RLS bypass via pg_has_role() (ADR-ACT-0184).
-- Granted to pgadmin_sysadmin below, and to the platform app user by migration 008.
-- This replaces the user-settable app.bypass_rls GUC which any connection holder
-- could SET to escalate privileges.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'rls_bypass') THEN
    CREATE ROLE rls_bypass NOLOGIN;
  END IF;
END
\$\$;

-- Grant rls_bypass to the platform app user so withSystemAdmin() works without a GUC.
-- Migration 008 also does this for existing databases; this covers fresh initdb installs.
DO \$\$
BEGIN
  IF NOT pg_has_role('${POSTGRES_USER}', 'rls_bypass', 'MEMBER') THEN
    GRANT rls_bypass TO "${POSTGRES_USER}";
  END IF;
END
\$\$;

-- pgadmin_sysadmin: system-admin pgAdmin connection only. Non-superuser so
-- FORCE ROW LEVEL SECURITY applies. Granted rls_bypass so cross-tenant data
-- is visible — same as withSystemAdmin() in the platform-api, but via role
-- membership (immutable by unprivileged sessions) not a user-settable GUC.
--
-- NOTE: pgadmin_tenant_admin is intentionally NOT created here.
-- Tenant-scoped pgAdmin access remains disabled until a separate role-level
-- tenant isolation design is implemented (see ADR-0029 and ADR-ACT-0184).
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PGADMIN_SYSADMIN_ROLE}') THEN
    CREATE ROLE "${PGADMIN_SYSADMIN_ROLE}" LOGIN PASSWORD '${PGADMIN_SYSADMIN_PASS}';
  END IF;
END
\$\$;
GRANT rls_bypass TO "${PGADMIN_SYSADMIN_ROLE}";
ALTER ROLE "${PGADMIN_SYSADMIN_ROLE}" SET "app.current_tenant_id" = '';
GRANT CONNECT ON DATABASE "${PGADMIN_DB}" TO "${PGADMIN_SYSADMIN_ROLE}";
GRANT USAGE ON SCHEMA public TO "${PGADMIN_SYSADMIN_ROLE}";
GRANT ALL ON ALL TABLES IN SCHEMA public TO "${PGADMIN_SYSADMIN_ROLE}";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${PGADMIN_SYSADMIN_ROLE}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${PGADMIN_SYSADMIN_ROLE}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${PGADMIN_SYSADMIN_ROLE}";
EOSQL
