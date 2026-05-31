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
