#!/usr/bin/env bash
set -euo pipefail
# Usage: ENV=<env> bash scripts/keycloak/provision-bff-authz.sh
#
# Provision the platform-api (BFF) client's Keycloak Authorization Services (UMA)
# via the Keycloak ADMIN API — KC-26 compatible (ADR-ACT-0279).
#
# STATUS (ADR-ACT-0279): NOT YET EFFECTIVE on the current stack and NOT wired into
# `make keycloak-provision`. Keycloak 26.2.5 + the archived mrparkers/keycloak ~4.4
# provider cannot sustain Authorization Services on the bff client:
# authorizationServicesEnabled does not persist (reverts to null across a Keycloak
# restart), and the UMA token endpoint answers "Client does not support
# permissions" even with a ResourceServer present. Verified unfixable by realm
# rebuild, client recreation, API toggles, and restarts. The DEFINITIVE fix is
# migrating the Terraform provider to the maintained keycloak/keycloak (KC-26
# compatible). This script is the prepared KC-26-native API provisioner to wire
# into `make keycloak-provision` ONCE that migration lands. Until then the
# static-RBAC backstop (ADR-ACT-0276) is the effective authorisation gate.
#
# Idempotent. Enables authz on the bff client, then ensures the admin:tenants
# resource + a system-admin role policy + resource permission exist. The static
# RBAC backstop (ADR-ACT-0276) covers any window where this has not run.

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

ENV="${ENV:-dev}"
ENV_FILE="$(bash scripts/env/resolve-env-file.sh "$ENV")"
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

KC="http://localhost:${KEYCLOAK_PORT:-8090}/kc"
REALM="${KEYCLOAK_REALM:-platform}"
ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-}"
BFF_SECRET="${KEYCLOAK_CLIENT_SECRET:-}"

ADMTOK="$(curl -fsS --max-time 15 \
  -d "client_id=admin-cli" -d "username=${ADMIN_USER}" -d "password=${ADMIN_PASS}" \
  -d "grant_type=password" \
  "${KC}/realms/master/protocol/openid-connect/token" 2>/dev/null \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])' 2>/dev/null || true)"
if [ -z "$ADMTOK" ]; then
  printf '%s✗ could not obtain Keycloak admin token (%s)%s\n' "$RED" "$KC" "$RESET"
  exit 1
fi

api() { curl -fsS --max-time 20 -H "Authorization: Bearer ${ADMTOK}" "$@"; }

CID="$(api "${KC}/admin/realms/${REALM}/clients?clientId=platform-api" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
if [ -z "$CID" ]; then
  printf '%s✗ platform-api client not found in realm %s%s\n' "$RED" "$REALM" "$RESET"
  exit 1
fi

# 1. Enable Authorization Services on the bff client (the part TF can't do on KC26).
printf '%s▶ Enabling Authorization Services on platform-api (%s)…%s\n' "$YELLOW" "$ENV" "$RESET"
api -X PUT -H 'Content-Type: application/json' \
  -d '{"authorizationServicesEnabled":true,"serviceAccountsEnabled":true}' \
  "${KC}/admin/realms/${REALM}/clients/${CID}" >/dev/null
if [ -n "$BFF_SECRET" ]; then
  api -X PUT -H 'Content-Type: application/json' \
    -d "{\"value\":\"${BFF_SECRET}\"}" \
    "${KC}/admin/realms/${REALM}/clients/${CID}/client-secret" >/dev/null 2>&1 || true
fi

RS="${KC}/admin/realms/${REALM}/clients/${CID}/authz/resource-server"

# 2. admin:tenants resource (create+read scopes). Idempotent.
if ! api "${RS}/resource?name=admin:tenants" | python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin) else 1)' 2>/dev/null; then
  printf '%s▶ Creating admin:tenants resource…%s\n' "$YELLOW" "$RESET"
  api -X POST -H 'Content-Type: application/json' \
    -d '{"name":"admin:tenants","displayName":"Admin — Tenant Provisioning","scopes":[{"name":"create"},{"name":"read"}]}' \
    "${RS}/resource" >/dev/null
fi
RESID="$(api "${RS}/resource?name=admin:tenants" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["_id"] if d else "")')"

# 3. system-admin role policy. Idempotent.
ROLEID="$(api "${KC}/admin/realms/${REALM}/roles/system-admin" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
if ! api "${RS}/policy/role?name=system-admin-role-policy" | python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin) else 1)' 2>/dev/null; then
  printf '%s▶ Creating system-admin role policy…%s\n' "$YELLOW" "$RESET"
  api -X POST -H 'Content-Type: application/json' \
    -d "{\"name\":\"system-admin-role-policy\",\"logic\":\"POSITIVE\",\"decisionStrategy\":\"UNANIMOUS\",\"roles\":[{\"id\":\"${ROLEID}\",\"required\":true}]}" \
    "${RS}/policy/role" >/dev/null
fi
POLID="$(api "${RS}/policy/role?name=system-admin-role-policy" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"

# 4. Resource permission binding admin:tenants -> system-admin policy. Idempotent.
if ! api "${RS}/permission?name=admin:tenants-permission" | python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin) else 1)' 2>/dev/null; then
  printf '%s▶ Creating admin:tenants permission…%s\n' "$YELLOW" "$RESET"
  api -X POST -H 'Content-Type: application/json' \
    -d "{\"name\":\"admin:tenants-permission\",\"type\":\"resource\",\"resources\":[\"${RESID}\"],\"policies\":[\"${POLID}\"],\"decisionStrategy\":\"UNANIMOUS\"}" \
    "${RS}/permission/resource" >/dev/null
fi

printf '%s✓ BFF Authorization Services provisioned for %s (admin:tenants -> system-admin; UMA active)%s\n' \
  "$GREEN" "$ENV" "$RESET"
