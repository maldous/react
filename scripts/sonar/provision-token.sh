#!/usr/bin/env bash
set -euo pipefail
# Usage: provision-token.sh
# Idempotent — validates existing SONAR_TOKEN, auto-generates a fresh one when
# the token is missing, invalid, or a placeholder.  Writes the new token into
# .env.sonar so subsequent `make sonar` calls are fast no-ops.
#
# The script is designed for "from scratch" regeneration: after a fresh
# sonar-postgres volume is created, the admin/admin default credentials are
# used to mint a project analysis token programmatically — no browser needed.

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

SONAR_ENV_FILE=".env.sonar"
SONAR_ENV_EXAMPLE=".env.sonar.example"

# ── 1. Ensure .env.sonar exists ────────────────────────────────────────────────

if [ ! -f "$SONAR_ENV_FILE" ]; then
  if [ -f "$SONAR_ENV_EXAMPLE" ]; then
    printf '%s.env.sonar not found — copying from .env.sonar.example%s\n' "$YELLOW" "$RESET"
    cp "$SONAR_ENV_EXAMPLE" "$SONAR_ENV_FILE"
  else
    printf '%s✗ Neither .env.sonar nor .env.sonar.example found%s\n' "$RED" "$RESET"
    exit 1
  fi
fi

# ── 2. Source config ───────────────────────────────────────────────────────────

# shellcheck disable=SC1090
set -a
source "$SONAR_ENV_FILE"
set +a

SONAR_HOST="${SONAR_HOST_URL:-http://localhost:9064/sonar}"
SONAR_HOST="${SONAR_HOST%/}"          # strip trailing slash
SONAR_KEY="${SONAR_PROJECT_KEY:-maldous-react}"

# ── 3. Validate existing token (if any) ────────────────────────────────────────

token_valid() {
  local token="$1"
  local body
  # /api/authentication/validate returns {"valid":true} or {"valid":false}
  # both with HTTP 200, so we must parse the JSON body.
  body=$(curl -sf --max-time 10 \
    -u "${token}:" \
    "${SONAR_HOST}/api/authentication/validate" 2>/dev/null || true)
  echo "$body" | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('valid') else 1)" 2>/dev/null
}

CURRENT_TOKEN="${SONAR_TOKEN:-}"

# Treat empty and placeholder tokens the same as missing
if [ -n "$CURRENT_TOKEN" ] && ! echo "$CURRENT_TOKEN" | grep -q '<'; then
  if token_valid "$CURRENT_TOKEN"; then
    printf '%s✓ SonarQube token is valid — nothing to provision%s\n' "$GREEN" "$RESET"
    exit 0
  fi
  printf '%sSonarQube token is invalid (expired / revoked / fresh DB) — regenerating…%s\n' \
    "$YELLOW" "$RESET"
else
  printf '%sSonarQube token not set (or still a placeholder) — generating…%s\n' \
    "$YELLOW" "$RESET"
fi

# ── 4. Ensure SonarQube is reachable ───────────────────────────────────────────

wait_sonar() {
  local attempts=0 max=60
  while [ $attempts -lt $max ]; do
    if curl -sf --max-time 3 "${SONAR_HOST}/api/system/status" > /dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  return 1
}

if ! wait_sonar; then
  printf '%s▶ SonarQube not reachable — starting via make sonar-up…%s\n' "$YELLOW" "$RESET"
  make sonar-up
  sleep 3
  if ! wait_sonar; then
    printf '%s✗ SonarQube did not become reachable at %s%s\n' "$RED" "$SONAR_HOST" "$RESET"
    exit 1
  fi
fi

# ── 5. Authenticate as admin and generate a token ──────────────────────────────

# SonarQube 9.9 LTS: POST /api/user_tokens/generate
# Auth: Basic with admin credentials
# Body (form-encoded): name=<token-name>&login=admin&type=GLOBAL_ANALYSIS_TOKEN
#
# On a fresh instance admin/admin is the default. If the admin password has
# been changed, the script will fail here — re-generate manually or set
# ADMIN_PASSWORD in .env.sonar.

ADMIN_USER="${SONAR_ADMIN_USER:-admin}"
ADMIN_PASS="${SONAR_ADMIN_PASSWORD:-admin}"
TOKEN_NAME="${SONAR_TOKEN_NAME:-codebuff-auto}"

printf '%s▶ Generating analysis token "%s" for user "%s"…%s\n' \
  "$YELLOW" "$TOKEN_NAME" "$ADMIN_USER" "$RESET"

RESP=$(curl -s --max-time 15 \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X POST \
  -d "name=${TOKEN_NAME}" \
  -d "login=${ADMIN_USER}" \
  "${SONAR_HOST}/api/user_tokens/generate" 2>&1) || true

# ── 6. Extract token from response ─────────────────────────────────────────────

# Expected response: {"login":"admin","name":"codebuff-auto","token":"squ_…","type":"GLOBAL_ANALYSIS_TOKEN",…}
# On failure: {"errors":[{"msg":"…"}]}

if echo "$RESP" | grep -q '"errors"'; then
  printf '%s✗ Token generation failed. SonarQube response:%s\n' "$RED" "$RESET"
  echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
  printf '\n%s  Possible causes:%s\n' "$YELLOW" "$RESET"
  printf '%s  1. Admin password changed — set SONAR_ADMIN_PASSWORD in .env.sonar%s\n' \
    "$YELLOW" "$RESET"
  printf '%s  2. SonarQube still initialising — retry in 30s%s\n' "$YELLOW" "$RESET"
  printf '%s  3. Token name "%s" already exists — delete it in the UI or use a new name%s\n' \
    "$YELLOW" "$TOKEN_NAME" "$RESET"
  exit 1
fi

NEW_TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || true)

if [ -z "$NEW_TOKEN" ]; then
  printf '%s✗ Could not extract token from SonarQube response:%s\n' "$RED" "$RESET"
  echo "$RESP"
  exit 1
fi

# ── 7. Write token to .env.sonar ───────────────────────────────────────────────

printf '%s✓ Got new token: %s…%s\n' "$GREEN" "${NEW_TOKEN:0:12}" "$RESET"

# Replace the SONAR_TOKEN line in-place, or append if missing
if grep -q '^SONAR_TOKEN=' "$SONAR_ENV_FILE"; then
  sed -i "s|^SONAR_TOKEN=.*|SONAR_TOKEN=${NEW_TOKEN}|" "$SONAR_ENV_FILE"
else
  echo "SONAR_TOKEN=${NEW_TOKEN}" >> "$SONAR_ENV_FILE"
fi

printf '%s✓ Token saved to %s%s\n' "$GREEN" "$SONAR_ENV_FILE" "$RESET"
