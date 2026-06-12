#!/usr/bin/env bash
# Local Postgres backup (ADR-ACT-0229). Local-only operator convenience.
#
# Dumps the platform Postgres for the given ENV to a gzipped file under an ignored
# local-artifact dir (.local-artifacts/backups, never committed). Prints the output path.
#
# Usage: ENV=test bash scripts/backup/postgres-backup.sh
#   POSTGRES_URL overrides the connection; else resolved from .env.<ENV>; else the dev default.
#   BACKUP_DIR overrides the output directory.
set -euo pipefail

ENV="${ENV:-dev}"
URL="${POSTGRES_URL:-}"
if [ -z "$URL" ] && [ -f ".env.${ENV}" ]; then
  URL="$(grep '^POSTGRES_URL=' ".env.${ENV}" | head -1 | cut -d= -f2- || true)"
fi
URL="${URL:-postgresql://platform:platformpassword@localhost:5433/platform}"

OUT_DIR="${BACKUP_DIR:-.local-artifacts/backups}"
mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT_DIR}/${ENV}-${TS}.sql.gz"

# --no-owner/--no-privileges keep the dump portable across local roles.
pg_dump --no-owner --no-privileges "$URL" | gzip >"$OUT"
echo "$OUT"
