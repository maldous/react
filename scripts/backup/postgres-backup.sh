#!/usr/bin/env bash
# Local Postgres backup (ADR-ACT-0229, hardened ADR-ACT-0235). Local-only operator convenience.
#
# Dumps the platform Postgres for the given ENV to a gzipped file under an ignored
# local-artifact dir (.local-artifacts/backups, never committed). Prints the output path.
#
# Guards:
#   - ENV outside dev|test (e.g. staging/prod) is REFUSED unless ALLOW_BACKUP_ENV=<ENV>
#     is explicitly supplied — this script must never quietly dump a shared database.
#   - Dumps may contain sensitive rows: umask 077 + chmod 600 keep them owner-only.
#
# Usage: ENV=test bash scripts/backup/postgres-backup.sh
#   POSTGRES_URL overrides the connection; else resolved from .env.<ENV>; else the dev default.
#   BACKUP_DIR overrides the output directory.
set -euo pipefail

ENV="${ENV:-dev}"
case "$ENV" in
  dev | test) ;;
  *)
    if [ "${ALLOW_BACKUP_ENV:-}" != "$ENV" ]; then
      echo "refusing: backups for ENV='${ENV}' require explicit ALLOW_BACKUP_ENV=${ENV}" >&2
      exit 1
    fi
    ;;
esac

# Dump files are owner-only from the moment they exist.
umask 077

URL="${POSTGRES_URL:-}"
_ENVF="$(bash "$(dirname "$0")/../env/resolve-env-file.sh" "$ENV" 2>/dev/null || echo ".env.${ENV}")"
if [ -z "$URL" ] && [ -f "$_ENVF" ]; then
  URL="$(grep '^POSTGRES_URL=' "$_ENVF" | head -1 | cut -d= -f2- || true)"
fi
URL="${URL:-postgresql://platform:platformpassword@localhost:5433/platform}"

OUT_DIR="${BACKUP_DIR:-.local-artifacts/backups}"
mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT_DIR}/${ENV}-${TS}.sql.gz"

# --no-owner/--no-privileges keep the dump portable across local roles.
pg_dump --no-owner --no-privileges "$URL" | gzip >"$OUT"
chmod 600 "$OUT"
echo "$OUT"
