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

# ADR-0072: the generated runtime artifact .env/sonar.env (from
# config/environments/shared.json) is the source. The runtime-provisioned analysis
# token is seeded into .env/secrets/sonar.env (gitignored). No hand-maintained
# .env.sonar / .env.sonar.example.
SECRETS_FILE=".env/secrets/sonar.env"

# ── 1. Materialise + source the generated sonar runtime env ─────────────────────

SONAR_ENV_FILE="$(bash scripts/env/resolve-env-file.sh sonar)"

# shellcheck disable=SC1090
set -a
source "$SONAR_ENV_FILE"
set +a

SONAR_HOST="${SONAR_HOST_URL:-http://localhost:9064/sonar}"
SONAR_HOST="${SONAR_HOST%/}"          # strip trailing slash
SONAR_KEY="${SONAR_PROJECT_KEY:-maldous-react}"

# ── 3. Define the existing-token validator ──────────────────────────────────────
# NOTE (ordering): the token-validity EARLY EXIT was moved to §4c, AFTER the admin
# password rotation (§4b). Previously this section did `exit 0` when the token was
# already valid — the steady state — so on any instance whose analysis token was
# already minted the default admin/admin password was NEVER rotated, leaving the
# "default administrator credentials are still used" prompt forever. The password
# rotation must run on every invocation; the token-generation skip is the only
# optimisation that may short-circuit.

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

# ── 4b. Ensure the admin password is the MANAGED value (ADR-0072 / no forced change) ──
# SonarQube forces a password change on UI login while the admin still has the default
# "admin/admin". We change it once, programmatically, to the managed SONAR_ADMIN_PASSWORD
# (from the generated env / OpenBao) so click-through login is never interrupted and
# rotation moves into the app later. Idempotent: a no-op once already managed.

ADMIN_USER="${SONAR_ADMIN_USER:-admin}"
MANAGED_PASS="${SONAR_ADMIN_PASSWORD:-}"

sonar_auth_ok() {
  curl -sf --max-time 10 -u "${ADMIN_USER}:$1" "${SONAR_HOST}/api/authentication/validate" 2>/dev/null \
    | grep -q '"valid":true'
}

if [ -n "$MANAGED_PASS" ] && [ "$MANAGED_PASS" != "admin" ]; then
  if sonar_auth_ok "$MANAGED_PASS"; then
    printf '%s✓ Sonar admin already on the managed password%s\n' "$GREEN" "$RESET"
  elif sonar_auth_ok "admin"; then
    if curl -sf --max-time 15 -u "${ADMIN_USER}:admin" -X POST \
      --data-urlencode "login=${ADMIN_USER}" \
      --data-urlencode "previousPassword=admin" \
      --data-urlencode "password=${MANAGED_PASS}" \
      "${SONAR_HOST}/api/users/change_password" >/dev/null 2>&1; then
      printf '%s✓ Sonar admin password set to the managed value — no forced change on login%s\n' \
        "$GREEN" "$RESET"
    else
      printf '%s⚠ could not set the managed Sonar admin password (continuing with default)%s\n' \
        "$YELLOW" "$RESET"
    fi
  fi
fi

# ── 4c. Token early-exit (runs AFTER §4b so the password is always ensured) ─────

CURRENT_TOKEN="${SONAR_TOKEN:-}"

# Treat empty and placeholder tokens the same as missing
if [ -n "$CURRENT_TOKEN" ] && ! echo "$CURRENT_TOKEN" | grep -q '<'; then
  if token_valid "$CURRENT_TOKEN"; then
    printf '%s✓ SonarQube token is valid — nothing more to provision%s\n' "$GREEN" "$RESET"
    exit 0
  fi
  printf '%sSonarQube token is invalid (expired / revoked / fresh DB) — regenerating…%s\n' \
    "$YELLOW" "$RESET"
else
  printf '%sSonarQube token not set (or still a placeholder) — generating…%s\n' \
    "$YELLOW" "$RESET"
fi

# ── 5. Authenticate as admin and generate a token ──────────────────────────────

# SonarQube 9.9 LTS: POST /api/user_tokens/generate. Auth: Basic with admin creds.
# Prefer the managed password (set above); fall back to the default for a brand-new
# instance where the change has not happened yet.
ADMIN_PASS="$MANAGED_PASS"
if [ -z "$ADMIN_PASS" ] || ! sonar_auth_ok "$ADMIN_PASS"; then ADMIN_PASS="admin"; fi
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
  printf '%s  1. Admin password changed — set SONAR_ADMIN_PASSWORD via config/environments/shared.json%s\n' \
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

# ── 7. Persist token to seeded material + regenerate the artifact (ADR-0072) ────

printf '%s✓ Got new token: %s…%s\n' "$GREEN" "${NEW_TOKEN:0:12}" "$RESET"

# The token is secret + runtime-provisioned → seed it into .env/secrets/sonar.env
# (gitignored), then regenerate .env/sonar.env so it picks the seeded value up.
mkdir -p "$(dirname "$SECRETS_FILE")"
touch "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
if grep -q '^SONAR_TOKEN=' "$SECRETS_FILE"; then
  sed -i "s|^SONAR_TOKEN=.*|SONAR_TOKEN=${NEW_TOKEN}|" "$SECRETS_FILE"
else
  echo "SONAR_TOKEN=${NEW_TOKEN}" >> "$SECRETS_FILE"
fi
node scripts/env/generate-runtime-env.mjs sonar >/dev/null
printf '%s✓ Token seeded to %s + .env/sonar.env regenerated%s\n' "$GREEN" "$SECRETS_FILE" "$RESET"
