#!/usr/bin/env bash
set -euo pipefail
# Usage: run-stage.sh <STAGE>
# Policy-driven stage runner. Reads env/stage-policy.yaml.

STAGE="${1:?STAGE required}"
POLICY_FILE="env/stage-policy.yaml"
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
BOLD=$(tput bold 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# ── 1. Parse stage-policy.yaml (pure awk — no yq/python required) ────────────

parse_policy() {
    local key="$1"
    awk -v stage="${STAGE}:" -v key="  ${key}:" '
        /^[a-z]/ { in_stage = ($0 == stage) }
        in_stage && $0 ~ "^" key {
            sub(/^  [^:]+:[ ]*/, "")
            print
            exit
        }
    ' "$POLICY_FILE"
}

parse_list() {
    local key="$1"
    awk -v stage="${STAGE}:" -v key="  ${key}:" '
        /^[a-z]/ { in_stage = ($0 == stage); in_list = 0 }
        in_stage && $0 == key { in_list = 1; next }
        in_list && /^    - / { sub(/^    - /, ""); print }
        in_list && /^  [^ ]/ { in_list = 0 }
    ' "$POLICY_FILE"
}

EXECUTOR="$(parse_policy executor)"
DATA_POLICY="$(parse_policy dataPolicy)"
AUTH_MODE="$(parse_policy authMode)"
TEARDOWN="$(parse_policy teardownDefault)"

REQUIRED_CSV="$(parse_list requiredTests | tr '\n' ',' | sed 's/,$//')"
EXCLUDED_CSV="$(parse_list excludedTests | tr '\n' ',' | sed 's/,$//')"

printf '\n%s▶ stage:%s — executor=%s dataPolicy=%s authMode=%s teardown=%s%s\n' \
    "${BOLD}${GREEN}" "$STAGE" "$EXECUTOR" "$DATA_POLICY" "$AUTH_MODE" "$TEARDOWN" "$RESET"

# ── 2. Source env file ────────────────────────────────────────────────────────

ENV_FILE=".env.${STAGE}"
[ -f "$ENV_FILE" ] || { printf '%s✗ %s not found%s\n' "$RED" "$ENV_FILE" "$RESET"; exit 1; }
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

# ── 3. Policy guards ──────────────────────────────────────────────────────────

if [ "$AUTH_MODE" = "real" ] && [ -n "${LOCAL_FIXTURE_SESSION:-}" ]; then
    printf '%s✗ Policy violation: LOCAL_FIXTURE_SESSION is set in %s (authMode=real)%s\n' \
        "$RED" "$STAGE" "$RESET"
    exit 1
fi

if [ "$STAGE" = "staging" ] || [ "$STAGE" = "prod" ]; then
    if [ "${COOKIE_SECURE:-}" = "false" ]; then
        printf '%s✗ Policy violation: COOKIE_SECURE=false in %s%s\n' "$RED" "$STAGE" "$RESET"
        exit 1
    fi
fi

if [ "$DATA_POLICY" = "preserve" ] && [ "${ALLOW_PROD_MUTATION:-}" != "true" ]; then
    printf '%s⚠ Stage %s: dataPolicy=preserve — reset/seed/volumes blocked (set ALLOW_PROD_MUTATION=true to override)%s\n' \
        "$YELLOW" "$STAGE" "$RESET"
fi

# ── 4. Stage-scoped preflight ─────────────────────────────────────────────────

if [ "$EXECUTOR" = "tilt" ]; then
    bash scripts/preflight/check-binaries.sh
else
    bash scripts/preflight/check-binaries.sh --no-tilt
fi

# ── 5. Data policy — pre-run cleanup ─────────────────────────────────────────

STAGE_RESULT=0

if [ "$DATA_POLICY" = "destructive" ]; then
    printf '%sResetting data for %s (destructive policy)...%s\n' "$YELLOW" "$STAGE" "$RESET"
    make compose-down-reset ENV="$STAGE"
fi

# ── 6. Start executor ─────────────────────────────────────────────────────────

if [ "$STAGE_RESULT" -eq 0 ]; then
    if [ "$EXECUTOR" = "tilt" ]; then
        bash scripts/tilt/up-dev.sh || STAGE_RESULT=1
    else
        bash scripts/compose/up.sh "$STAGE" web || STAGE_RESULT=1
    fi
fi

# ── 7. Wait for readiness ─────────────────────────────────────────────────────

if [ "$STAGE_RESULT" -eq 0 ]; then
    bash scripts/compose/wait.sh "$STAGE" 120 || STAGE_RESULT=1
fi

# ── 8. Migrations + seed ──────────────────────────────────────────────────────

if [ "$STAGE_RESULT" -eq 0 ]; then
    npm run db:migrate || STAGE_RESULT=1
fi

if [ "$STAGE_RESULT" -eq 0 ] && [ "$DATA_POLICY" = "destructive" ]; then
    npm run db:seed || STAGE_RESULT=1
fi

# ── 9. Test groups ────────────────────────────────────────────────────────────

if [ "$STAGE_RESULT" -eq 0 ] && [ -n "$REQUIRED_CSV" ]; then
    bash scripts/tests/run-env-tests.sh "$STAGE" "$REQUIRED_CSV" "$EXCLUDED_CSV" \
        || STAGE_RESULT=1
fi

# ── 10. E2E equivalent (staging/prod only) ───────────────────────────────────
#
# dev/test: e2e-smoke in requiredTests already invokes e2e-internal with
# proper port isolation (see run-env-tests.sh). Calling it again here would
# cause a double-invocation that hits port conflicts with the compose API.
#
# staging/prod: run-stage-tests.sh runs e2e-external-smoke via e2e-smoke /
# external-smoke groups, but step 10 additionally runs the full e2e-external
# suite (all specs, not just smoke) for broader pre-merge confidence.

if [ "$STAGE_RESULT" -eq 0 ]; then
    case "$STAGE" in
      dev|test)
        # E2E owned by e2e-smoke in requiredTests — no second invocation here.
        :
        ;;
      staging)
        PROD_BASE_URL="${PROD_BASE_URL:-https://staging.aldous.info}" \
        make e2e-external || STAGE_RESULT=1
        ;;
      prod)
        PROD_BASE_URL="${PROD_BASE_URL:-https://aldous.info}" \
        make e2e-external || STAGE_RESULT=1
        [ "$STAGE_RESULT" -eq 0 ] && { npm run test:e2e:prod || STAGE_RESULT=1; }
        ;;
    esac
fi

# ── 11 + 12. Teardown ─────────────────────────────────────────────────────────

teardown() {
    if [ "$TEARDOWN" = "true" ] && [ "${KEEP_STACKS_UP:-}" != "true" ]; then
        printf '%sTearing down %s (teardownDefault=true)...%s\n' "$YELLOW" "$STAGE" "$RESET"
        if [ "$EXECUTOR" = "tilt" ]; then
            bash scripts/tilt/down-dev.sh 2>/dev/null || true
        fi
        make compose-down-reset ENV="$STAGE" 2>/dev/null || true
    fi
}

teardown

# ── 13. Write evidence ────────────────────────────────────────────────────────

RESULT_STR="passed"
[ "$STAGE_RESULT" -ne 0 ] && RESULT_STR="failed"

node scripts/evidence/write-stage-evidence.mjs \
    "$STAGE" "$RESULT_STR" "$START_TS" "$REQUIRED_CSV" "$EXCLUDED_CSV" \
    2>/dev/null || printf '%s⚠ evidence write failed (non-fatal)%s\n' "$YELLOW" "$RESET"

# ── 14. Exit ──────────────────────────────────────────────────────────────────

if [ "$STAGE_RESULT" -eq 0 ]; then
    printf '\n%s✓ stage:%s PASSED%s\n' "$GREEN" "$STAGE" "$RESET"
else
    printf '\n%s✗ stage:%s FAILED%s\n' "$RED" "$STAGE" "$RESET"
fi

exit "$STAGE_RESULT"
