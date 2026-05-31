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
PGADMIN_ROLE="pgadmin_sysadmin"
PGADMIN_PASS="${PGADMIN_DB_PASSWORD:-pgadmin-sysadmin-password}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$PGADMIN_DB" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PGADMIN_ROLE}') THEN
    CREATE ROLE "${PGADMIN_ROLE}" LOGIN PASSWORD '${PGADMIN_PASS}';
  END IF;
END
\$\$;

-- Not a superuser: RLS policies apply to this role.
-- app.bypass_rls = true mirrors withSystemAdmin() in the application layer.
-- This means pgAdmin sees all tenant data but RLS is still enforced (not bypassed).
ALTER ROLE "${PGADMIN_ROLE}" SET "app.bypass_rls" = 'true';
ALTER ROLE "${PGADMIN_ROLE}" SET "app.current_tenant_id" = '';

-- Full access to the platform database for administration
GRANT CONNECT ON DATABASE "${PGADMIN_DB}" TO "${PGADMIN_ROLE}";
GRANT USAGE ON SCHEMA public TO "${PGADMIN_ROLE}";
GRANT ALL ON ALL TABLES IN SCHEMA public TO "${PGADMIN_ROLE}";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${PGADMIN_ROLE}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${PGADMIN_ROLE}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${PGADMIN_ROLE}";
EOSQL
