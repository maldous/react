#!/usr/bin/env bash
set -euo pipefail
# Usage: ensure-quality-gate.sh
# Idempotently creates and assigns the "Governance Tooling" SonarQube quality
# gate defined by ADR-0016, then assigns it to the project. Safe to re-run after
# a fresh sonar-postgres volume (which otherwise leaves the project on the
# built-in "Sonar way" gate — whose 80% new-code coverage condition contradicts
# ADR-0016, since coverage tooling is intentionally not a gate here and frontend
# vitest coverage is not ingested into Sonar).
#
# ADR-0016 "Governance Tooling" gate conditions (no coverage / no duplication):
#   bugs = 0, vulnerabilities = 0, code_smells = 0,
#   security_hotspots_reviewed = 100%, reliability_rating = A,
#   security_rating = A, maintainability (sqale) rating = A.

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# ADR-0072: source the generated .env/sonar.env (from config/environments/shared.json).
SONAR_ENV_FILE="$(bash scripts/env/resolve-env-file.sh sonar 2>/dev/null || echo .env/sonar.env)"
if [ -f "$SONAR_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  source "$SONAR_ENV_FILE"
  set +a
fi

HOST="${SONAR_HOST_URL:-http://localhost:9064/sonar}"
HOST="${HOST%/}"
PROJECT_KEY="${SONAR_PROJECT_KEY:-maldous-react}"
GATE_NAME="Governance Tooling"
ADMIN_USER="${SONAR_ADMIN_USER:-admin}"
ADMIN_PASS="${SONAR_ADMIN_PASSWORD:-admin}"

# ── 1. Create the gate (ignore "already exists") ───────────────────────────────
printf '%s▶ Ensuring quality gate "%s"…%s\n' "$YELLOW" "$GATE_NAME" "$RESET"
curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" -X POST \
  --data-urlencode "name=${GATE_NAME}" \
  "${HOST}/api/qualitygates/create" > /dev/null 2>&1 || true

# ── 2. Reconcile conditions ────────────────────────────────────────────────────
# metric|op|error
CONDITIONS=(
  "bugs|GT|0"
  "vulnerabilities|GT|0"
  "code_smells|GT|0"
  "security_hotspots_reviewed|LT|100"
  "reliability_rating|GT|1"
  "security_rating|GT|1"
  "sqale_rating|GT|1"
)

# Existing conditions on the gate (so re-runs do not duplicate).
existing=$(curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" \
  "${HOST}/api/qualitygates/show?name=$(printf '%s' "$GATE_NAME" | sed 's/ /%20/g')" 2>/dev/null || echo '{}')

for cond in "${CONDITIONS[@]}"; do
  metric="${cond%%|*}"; rest="${cond#*|}"; op="${rest%%|*}"; err="${rest##*|}"
  if echo "$existing" | python3 -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if any(c.get('metric')=='$metric' for c in d.get('conditions',[])) else 1)" 2>/dev/null; then
    continue   # already present
  fi
  curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" -X POST \
    --data-urlencode "gateName=${GATE_NAME}" \
    --data-urlencode "metric=${metric}" \
    --data-urlencode "op=${op}" \
    --data-urlencode "error=${err}" \
    "${HOST}/api/qualitygates/create_condition" > /dev/null 2>&1 || true
done

# ── 2b. Remove conditions ADR-0016 does NOT enforce (coverage / duplication) ───
# A pre-existing gate may carry the built-in coverage / duplication conditions;
# ADR-0016 intentionally omits both (coverage tooling is not fully wired and
# frontend vitest coverage is not ingested into Sonar).
current=$(curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" \
  "${HOST}/api/qualitygates/show?name=$(printf '%s' "$GATE_NAME" | sed 's/ /%20/g')" 2>/dev/null || echo '{}')
remove_ids=$(echo "$current" | python3 -c "
import sys, json
drop = {'coverage', 'new_coverage', 'duplicated_lines_density', 'new_duplicated_lines_density'}
d = json.load(sys.stdin)
print(' '.join(c['id'] for c in d.get('conditions', []) if c.get('metric') in drop))
" 2>/dev/null || true)
for cid in $remove_ids; do
  curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" -X POST \
    --data-urlencode "id=${cid}" \
    "${HOST}/api/qualitygates/delete_condition" > /dev/null 2>&1 || true
  printf '%s  removed non-ADR-0016 condition (id=%s)%s\n' "$YELLOW" "$cid" "$RESET"
done

# ── 3. Ensure the project exists (idempotent — so a fresh volume can assign the
#       gate before the first scan rather than defaulting to "Sonar way") ───────
curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" -X POST \
  --data-urlencode "project=${PROJECT_KEY}" \
  --data-urlencode "name=${PROJECT_KEY}" \
  "${HOST}/api/projects/create" > /dev/null 2>&1 || true

# ── 4. Assign the gate to the project ──────────────────────────────────────────
if curl -s --max-time 15 -u "${ADMIN_USER}:${ADMIN_PASS}" -X POST \
  --data-urlencode "gateName=${GATE_NAME}" \
  --data-urlencode "projectKey=${PROJECT_KEY}" \
  "${HOST}/api/qualitygates/select" > /dev/null 2>&1; then
  printf '%s✓ Quality gate "%s" assigned to %s%s\n' "$GREEN" "$GATE_NAME" "$PROJECT_KEY" "$RESET"
else
  printf '%s✗ Failed to assign quality gate (check admin credentials in .env/sonar.env)%s\n' \
    "$RED" "$RESET"
fi
