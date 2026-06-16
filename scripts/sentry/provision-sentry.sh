#!/usr/bin/env bash
set -euo pipefail
# Usage: provision-sentry.sh
#
# Auto-provision the self-hosted Sentry project + DSN + API token so Phase 5.5
# (ADR-ACT-0285) works from a clean `make all` with NO manual browser step — the
# same "from scratch" pattern as scripts/sonar/provision-token.sh.
#
# Idempotent. Via `sentry django shell` in the running sentry-web container it:
#   1. ensures the org (SENTRY_ORG_SLUG, default "sentry") + a team + the project
#      (SENTRY_PROJECT_SLUG, default "react-sentry"),
#   2. ensures a ProjectKey (the DSN public key — NOT a secret; it is meant to be
#      embedded in clients),
#   3. ensures the superuser is an OrganizationMember (owner) so its API token can
#      read the project,
#   4. ensures an ApiToken with read scopes (the token IS secret; only ever written
#      to .env/secrets/<stage>.env, never logged).
# It then builds the ingest DSN against the in-cluster relay (sentry-relay:3000,
# reachable by platform-api over the sentry-bridge network) and seeds SENTRY_DSN +
# SENTRY_API_TOKEN into each reporting stage's secrets, regenerating the runtime env.
#
# Degrades honestly: if the Sentry stack is not running, it logs and exits 0 so the
# confidence ladder is never broken by an optional substrate.

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

WEB="react-shared-sentry-web-1"
ORG="${SENTRY_ORG_SLUG:-sentry}"
PROJECT="${SENTRY_PROJECT_SLUG:-react-sentry}"
RELAY_HOST="${SENTRY_RELAY_INGEST_HOST:-sentry-relay:3000}"
# Stages whose platform-api reports to Sentry + run the Phase 5.5 assertion.
STAGES="${SENTRY_PROVISION_STAGES:-test staging prod}"

if ! docker ps --format '{{.Names}}' | grep -q "^${WEB}$"; then
  printf '%s⚠ %s not running — skipping Sentry provisioning (DEGRADED, non-fatal)%s\n' \
    "$YELLOW" "$WEB" "$RESET"
  exit 0
fi

# Wait for the Sentry API to answer (web healthy).
for _ in $(seq 1 30); do
  if curl -sf --max-time 3 "http://localhost:${SENTRY_PORT:-9060}/api/0/" >/dev/null 2>&1; then break; fi
  sleep 2
done

printf '%s▶ provisioning Sentry project/DSN/token (org=%s project=%s)…%s\n' \
  "$YELLOW" "$ORG" "$PROJECT" "$RESET"

# One idempotent ORM transaction; emits a parseable RESULT line. Token is secret.
OUT="$(docker exec -e ORG="$ORG" -e PROJECT="$PROJECT" "$WEB" sentry django shell -c "
import os
from sentry.models.organization import Organization
from sentry.models.organizationmember import OrganizationMember
from sentry.models.team import Team
from sentry.models.project import Project
from sentry.models.projectkey import ProjectKey
from sentry.models.apitoken import ApiToken
from django.contrib.auth import get_user_model
U=get_user_model()
admin=U.objects.filter(is_superuser=True).order_by('id').first()
org=Organization.objects.filter(slug=os.environ['ORG']).first() or Organization.objects.create(name=os.environ['ORG'], slug=os.environ['ORG'])
OrganizationMember.objects.get_or_create(organization=org, user_id=admin.id, defaults={'role':'owner'})
team=Team.objects.filter(organization=org, slug='platform').first() or Team.objects.create(organization=org, name='Platform', slug='platform')
proj=Project.objects.filter(organization=org, slug=os.environ['PROJECT']).first()
if proj is None:
    proj=Project.objects.create(organization=org, name=os.environ['PROJECT'], slug=os.environ['PROJECT'], platform='node')
    proj.add_team(team)
key=ProjectKey.objects.filter(project=proj).first() or ProjectKey.objects.create(project=proj)
tok=ApiToken.objects.filter(user=admin).order_by('id').first()
if tok is None:
    tok=ApiToken.objects.create(user=admin, scope_list=['org:read','project:read','event:read'])
print('RESULT project_id=%s public_key=%s token=%s' % (proj.id, key.public_key, tok.token))
" 2>/dev/null | grep '^RESULT ' | head -1)"

PROJECT_ID="$(echo "$OUT" | sed -n 's/.*project_id=\([^ ]*\).*/\1/p')"
PUBLIC_KEY="$(echo "$OUT" | sed -n 's/.*public_key=\([^ ]*\).*/\1/p')"
TOKEN="$(echo "$OUT" | sed -n 's/.*token=\([^ ]*\).*/\1/p')"

if [ -z "$PROJECT_ID" ] || [ -z "$PUBLIC_KEY" ] || [ -z "$TOKEN" ]; then
  printf '%s✗ Sentry provisioning produced no project/key/token — aborting%s\n' "$RED" "$RESET"
  exit 1
fi

DSN="http://${PUBLIC_KEY}@${RELAY_HOST}/${PROJECT_ID}"
printf '%s✓ Sentry project %s/%s id=%s key=%s… token=%s…%s\n' \
  "$GREEN" "$ORG" "$PROJECT" "$PROJECT_ID" "${PUBLIC_KEY:0:8}" "${TOKEN:0:8}" "$RESET"

# Seed SENTRY_DSN + SENTRY_API_TOKEN into each reporting stage's secrets material and
# regenerate the runtime env so platform-api (reports) + the assertion (queries) pick
# them up. The DSN public key is not secret; the token is.
seed() {
  local stage="$1" file=".env/secrets/$1.env"
  mkdir -p "$(dirname "$file")"; touch "$file"; chmod 600 "$file"
  for kv in "SENTRY_DSN=${DSN}" "SENTRY_API_TOKEN=${TOKEN}"; do
    local k="${kv%%=*}"
    if grep -q "^${k}=" "$file"; then
      sed -i "s|^${k}=.*|${kv}|" "$file"
    else
      echo "$kv" >> "$file"
    fi
  done
  node scripts/env/generate-runtime-env.mjs "$stage" >/dev/null 2>&1 || true
}
for s in $STAGES; do seed "$s"; printf '%s  • seeded SENTRY_DSN+token for %s%s\n' "$GREEN" "$s" "$RESET"; done
printf '%s✓ Sentry provisioning complete%s\n' "$GREEN" "$RESET"
