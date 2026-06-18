#!/usr/bin/env bash
set -euo pipefail
# Usage: provision-oidc.sh
#
# Provision Keycloak OIDC single-sign-on on the shared SonarQube instance
# (ADR-0073). Idempotent — safe to re-run; a no-op once already configured.
#
# WHY A SCRIPT (not compose env vars): SonarQube maps SONAR_* environment
# variables to properties by lowercasing, so it CANNOT set the sonar-auth-oidc
# plugin's camelCase properties (sonar.auth.oidc.issuerUri,
# sonar.auth.oidc.clientId.secured, sonar.auth.oidc.groupsSync.claimName, …).
# Those settings must be written through the web API, where they persist in the
# SonarQube database volume. This script reproduces them from scratch after a
# fresh sonar-postgres/sonarqube volume, exactly like provision-token.sh does for
# the analysis token.
#
# It also creates a "system-admin" SonarQube group with global administration
# permissions. Group sync maps the Keycloak realm role "system-admin" (emitted in
# the token's "roles" claim) to that group, so the platform system administrator
# gets full SonarQube access via SSO. Forward-auth (ADR-0030) already restricts
# /sonar to system administrators.

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# ── 1. Materialise + source the generated sonar runtime env (ADR-0072) ──────────

SONAR_ENV_FILE="$(bash scripts/env/resolve-env-file.sh sonar)"
# shellcheck disable=SC1090
set -a
source "$SONAR_ENV_FILE"
set +a

SONAR_HOST="${SONAR_HOST_URL:-http://localhost:9064/sonar}"
SONAR_HOST="${SONAR_HOST%/}"
ADMIN_USER="${SONAR_ADMIN_USER:-admin}"

# ── 2. SSO disabled → ensure the plugin is OFF and exit ─────────────────────────

if [ "${COMPOSE_SSO_ENABLED:-false}" != "true" ]; then
  printf '%sCOMPOSE_SSO_ENABLED!=true — skipping SonarQube OIDC provisioning%s\n' \
    "$YELLOW" "$RESET"
  exit 0
fi

# ── 3. Wait for SonarQube ───────────────────────────────────────────────────────

wait_sonar() {
  local attempts=0
  while [ $attempts -lt 60 ]; do
    if curl -sf --max-time 3 "${SONAR_HOST}/api/system/status" >/dev/null 2>&1; then return 0; fi
    attempts=$((attempts + 1)); sleep 2
  done
  return 1
}
if ! wait_sonar; then
  printf '%s✗ SonarQube not reachable at %s — is `make sonar-up` done?%s\n' \
    "$RED" "$SONAR_HOST" "$RESET"
  exit 1
fi

# ── 4. Resolve working admin credentials (managed value, else default) ──────────

sonar_auth_ok() {
  curl -sf --max-time 10 -u "${ADMIN_USER}:$1" "${SONAR_HOST}/api/authentication/validate" 2>/dev/null \
    | grep -q '"valid":true'
}
ADMIN_PASS="${SONAR_ADMIN_PASSWORD:-}"
if [ -z "$ADMIN_PASS" ] || ! sonar_auth_ok "$ADMIN_PASS"; then
  if sonar_auth_ok "admin"; then
    ADMIN_PASS="admin"
  else
    printf '%s✗ Neither managed nor default Sonar admin password works — cannot provision OIDC%s\n' \
      "$RED" "$RESET"
    exit 1
  fi
fi
A=(-u "${ADMIN_USER}:${ADMIN_PASS}")

if [ -z "${SONAR_OIDC_CLIENT_SECRET:-}" ]; then
  printf '%s✗ SONAR_OIDC_CLIENT_SECRET is empty — regenerate .env/sonar.env%s\n' "$RED" "$RESET"
  exit 1
fi

# ── 4b. Honesty gate: only provision OIDC if the plugin is actually installed ────
#
# SonarQube Community Build 25.9 has NO native OIDC. The sonar-auth-oidc plugin is
# the only way to add it, and it is NOT bundled in this deployment by default
# (SONAR_OIDC_PLUGIN_URL is empty; see compose.yaml sonar-oidc-plugin). Writing the
# sonar.auth.oidc.* settings when no plugin is present would leave the server
# advertising an SSO login that cannot work and let this script falsely report
# "OIDC provisioned". Instead we detect the plugin and, when it is absent, state the
# truthful posture — native managed auth behind the forward-auth gate (ADR-0030) —
# and make NO SSO claim (ADR-ACT-0290, Option B).
#
# To deliver OIDC, pin SONAR_OIDC_PLUGIN_URL to vaulttec sonar-auth-oidc v3.0.0 (the
# build compatible with SonarQube 25.x — v2.1.1 used the removed ServletFilter API
# and crash-loops) and re-run `make sonar-provision`.
oidc_plugin_installed() {
  curl -sf --max-time 10 "${A[@]}" "${SONAR_HOST}/api/plugins/installed" 2>/dev/null \
    | grep -q '"key":"authoidc"'
}
if ! oidc_plugin_installed; then
  printf '%sℹ SonarQube OIDC plugin not installed — SonarQube uses native managed auth behind the forward-auth gate (ADR-0030).%s\n' \
    "$YELLOW" "$RESET"
  printf '%s  To enable SSO: pin SONAR_OIDC_PLUGIN_URL to sonar-auth-oidc v3.0.0 (SonarQube 25.x-compatible) and re-run. Skipping OIDC settings — no SSO claimed (ADR-ACT-0290).%s\n' \
    "$YELLOW" "$RESET"
  exit 0
fi

# ── 5. Write the OIDC plugin settings (plugin confirmed present) ─────────────────

ISSUER="${SONAR_OIDC_ISSUER:-https://aldous.info/kc/realms/platform-production}"
PUBLIC_URL="${SONAR_PUBLIC_URL:-https://aldous.info/sonar}"

set_kv() {
  local code
  code=$(curl -s "${A[@]}" -o /dev/null -w '%{http_code}' -X POST "${SONAR_HOST}/api/settings/set" \
    --data-urlencode "key=$1" --data-urlencode "value=$2")
  if [ "$code" != "204" ]; then
    printf '%s  ✗ set %s -> http %s%s\n' "$RED" "$1" "$code" "$RESET"; return 1
  fi
}

printf '%s▶ Writing SonarQube OIDC settings…%s\n' "$YELLOW" "$RESET"
set_kv "sonar.core.serverBaseURL" "$PUBLIC_URL"
set_kv "sonar.auth.oidc.issuerUri" "$ISSUER"
set_kv "sonar.auth.oidc.clientId.secured" "sonarqube"
set_kv "sonar.auth.oidc.clientSecret.secured" "$SONAR_OIDC_CLIENT_SECRET"
set_kv "sonar.auth.oidc.scopes" "openid email profile"
set_kv "sonar.auth.oidc.loginButtonText" "Platform SSO"
set_kv "sonar.auth.oidc.groupsSync" "true"
set_kv "sonar.auth.oidc.groupsSync.claimName" "roles"
set_kv "sonar.auth.oidc.autoLogin" "true"
set_kv "sonar.auth.oidc.enabled" "true"

# ── 6. system-admin group + global admin permissions (group sync target) ────────

printf '%s▶ Ensuring "system-admin" group has Sonar administration…%s\n' "$YELLOW" "$RESET"
# create is a no-op (HTTP 400) once it exists.
curl -s "${A[@]}" -o /dev/null -X POST "${SONAR_HOST}/api/user_groups/create" \
  --data-urlencode "name=system-admin" \
  --data-urlencode "description=Platform system administrators (synced from the Keycloak realm role via OIDC, ADR-0073)" || true
for perm in admin gateadmin profileadmin provisioning scan; do
  curl -s "${A[@]}" -o /dev/null -X POST "${SONAR_HOST}/api/permissions/add_group" \
    --data-urlencode "groupName=system-admin" --data-urlencode "permission=$perm" || true
done

printf '%s✓ SonarQube OIDC SSO provisioned (issuer=%s, autoLogin, group sync -> system-admin)%s\n' \
  "$GREEN" "$ISSUER" "$RESET"
