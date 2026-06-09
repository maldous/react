#!/usr/bin/env bash
set -euo pipefail
# loki-smoke.sh [ENV]  (default: prod)
#
# Proves the ADR-0035 ingestion path end-to-end: a platform-api request is
# logged as structured JSON to stdout, scraped by Alloy, and queryable in Loki
# by requestId.
#
#   1. Hit platform-api /healthz and capture the X-Request-Id response header.
#   2. Poll the environment's Loki for a platform-api log line carrying that id.
#
# Ports are read from .env.<ENV> (host-exposed). Requires the env's web profile
# (containerised platform-api + Alloy + Loki) to be running — dev runs the BFF
# on the host via Tilt, so dev Alloy does not scrape it; use test/staging/prod.

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

ENV="${1:-prod}"
ENV_FILE=".env.${ENV}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

API_PORT="${PLATFORM_API_PORT:-3004}"
LOKI_PORT="${LOKI_PORT:-3103}"
API="http://localhost:${API_PORT}"
LOKI="http://localhost:${LOKI_PORT}"

printf '%s▶ loki-smoke (%s): API=%s LOKI=%s%s\n' "$YELLOW" "$ENV" "$API" "$LOKI" "$RESET"

# ── 1. Hit /healthz, capture X-Request-Id ──────────────────────────────────────
REQ_ID=$(curl -fsS -D - -o /dev/null --max-time 10 "${API}/healthz" 2>/dev/null \
  | grep -i '^x-request-id:' | tr -d '\r' | awk '{print $2}' || true)

if [ -z "$REQ_ID" ]; then
  printf '%s✗ loki-smoke: no X-Request-Id from %s/healthz (is platform-api up?)%s\n' \
    "$RED" "$API" "$RESET"
  exit 1
fi
printf '  requestId = %s\n' "$REQ_ID"

# ── 2. Poll Loki for a platform-api line carrying that requestId ────────────────
# requestId is queried as a `| json` field filter (ADR-0035: high-cardinality
# fields are structured metadata, not labels).
QUERY="{service=\"platform-api\"} | json | requestId=\"${REQ_ID}\""
DEADLINE=$(( $(date +%s) + 30 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  END=$(( $(date +%s) * 1000000000 ))
  START=$(( END - 600000000000 ))   # last 10 minutes
  COUNT=$(curl -fsS -G "${LOKI}/loki/api/v1/query_range" \
    --data-urlencode "query=${QUERY}" \
    --data-urlencode "start=${START}" \
    --data-urlencode "end=${END}" \
    --data-urlencode "limit=5" 2>/dev/null \
    | python3 -c "import sys,json; print(sum(len(s.get('values',[])) for s in json.load(sys.stdin).get('data',{}).get('result',[])))" 2>/dev/null || echo 0)
  if [ "${COUNT:-0}" -gt 0 ]; then
    printf '%s✓ loki-smoke: Loki has %s platform-api line(s) with requestId %s%s\n' \
      "$GREEN" "$COUNT" "$REQ_ID" "$RESET"
    exit 0
  fi
  sleep 3
done

printf '%s✗ loki-smoke: requestId %s not found in Loki within 30s%s\n' "$RED" "$REQ_ID" "$RESET"
printf '%s  (Alloy scrape lag, or this env does not ingest platform-api logs)%s\n' \
  "$YELLOW" "$RESET"
exit 1
