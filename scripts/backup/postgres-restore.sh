#!/usr/bin/env bash
# Local Postgres restore (ADR-ACT-0229). GUARDED, destructive, local-only.
#
# Refuses unless BOTH hold:
#   - ENV is dev or test (never staging/prod), AND
#   - CONFIRM_RESTORE=restore-<ENV> is supplied.
# This is intentionally hard to fire by accident; it overwrites the target database.
#
# Usage: ENV=test CONFIRM_RESTORE=restore-test bash scripts/backup/postgres-restore.sh <backup.sql.gz>
set -euo pipefail

ENV="${ENV:-}"
FILE="${1:-${BACKUP_FILE:-}}"
CONFIRM="${CONFIRM_RESTORE:-}"

case "$ENV" in
  dev | test) ;;
  *)
    echo "refusing: restore is only allowed for ENV=dev|test (got '${ENV}')" >&2
    exit 1
    ;;
esac

if [ "$CONFIRM" != "restore-${ENV}" ]; then
  echo "refusing: set CONFIRM_RESTORE=restore-${ENV} to confirm a destructive restore" >&2
  exit 1
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "backup file required (first arg or BACKUP_FILE), and must exist" >&2
  exit 1
fi

URL="${POSTGRES_URL:-}"
if [ -z "$URL" ] && [ -f ".env.${ENV}" ]; then
  URL="$(grep '^POSTGRES_URL=' ".env.${ENV}" | head -1 | cut -d= -f2- || true)"
fi
URL="${URL:-postgresql://platform:platformpassword@localhost:5433/platform}"

echo "restoring ${FILE} into ${ENV} database…" >&2
gunzip -c "$FILE" | psql "$URL" >/dev/null
echo "restored ${FILE}"
