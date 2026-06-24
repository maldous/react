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
        in_list && /^    - / { sub(/^    - /, ""); sub(/[[:space:]]+#.*$/, ""); print }
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

# ADR-0072: the generated artifact .env/<stage>.env (from the manifest) is the
# source; the resolver materialises it on demand. Legacy .env.<stage> is only a
# transition fallback. No hand-maintained env file is required.
ENV_FILE="$(bash scripts/env/resolve-env-file.sh "$STAGE")"
[ -f "$ENV_FILE" ] || { printf '%s✗ %s not found%s\n' "$RED" "$ENV_FILE" "$RESET"; exit 1; }
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

SEMANTIC_DEV=0
if [ "$STAGE" = "dev" ] && [ "$EXECUTOR" = "tilt" ]; then
    USF_PROVIDER_MODE="${USF_PROVIDER_MODE:-semantic-dev}"
    export USF_PROVIDER_MODE
    if [ "$USF_PROVIDER_MODE" = "semantic-dev" ] || [ "$USF_PROVIDER_MODE" = "in-memory" ]; then
        SEMANTIC_DEV=1
    fi
fi

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
        # All compose stages (destructive + preserve) start the full profile set required
        # by the V2 proof collector so every environment is capability-identical for
        # contract/runtime evidence: default + identity + mocks + provider substrates + web.
        # up.sh calls are idempotent — already-running preserve containers are no-ops.
        bash scripts/compose/up.sh "$STAGE" default || STAGE_RESULT=1
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" identity || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { make keycloak-provision ENV="$STAGE" || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" external-mocks || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" observability || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" secrets || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" workflow-provider || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" observability-provider || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" antivirus-provider || STAGE_RESULT=1; }
        [ "$STAGE_RESULT" -eq 0 ] && { bash scripts/compose/up.sh "$STAGE" web || STAGE_RESULT=1; }
    fi
fi

# ── 7. Wait for readiness ─────────────────────────────────────────────────────

if [ "$STAGE_RESULT" -eq 0 ]; then
    bash scripts/compose/wait.sh "$STAGE" 120 || STAGE_RESULT=1
fi

# ── 8. Migrations + seed ──────────────────────────────────────────────────────
# Always use the stage-specific POSTGRES_URL (derived from .env.$STAGE) so migrations
# target the correct environment. The migrate script silently exits 0 on ECONNREFUSED
# without this override — without it staging/prod would silently migrate the wrong DB.

_pg_port_m="$(grep -oP 'POSTGRES_PORT=\K\d+' "$ENV_FILE" 2>/dev/null | head -1 || true)"
_pg_port_m="${_pg_port_m:-5433}"
_pg_url_m="postgresql://platform:platformpassword@localhost:${_pg_port_m}/platform"

if [ "$STAGE_RESULT" -eq 0 ] && [ "$SEMANTIC_DEV" -eq 0 ]; then
    POSTGRES_URL="$_pg_url_m" npm run db:migrate || STAGE_RESULT=1
elif [ "$STAGE_RESULT" -eq 0 ]; then
    printf '%s↷ semantic-dev: skipping Postgres migrations for in-memory dev provider mode%s\n' "$YELLOW" "$RESET"
fi

if [ "$STAGE_RESULT" -eq 0 ] && [ "$DATA_POLICY" = "destructive" ] && [ "$SEMANTIC_DEV" -eq 0 ]; then
    POSTGRES_URL="$_pg_url_m" npm run db:seed || STAGE_RESULT=1
elif [ "$STAGE_RESULT" -eq 0 ] && [ "$DATA_POLICY" = "destructive" ]; then
    printf '%s↷ semantic-dev: skipping Postgres seed for in-memory dev provider mode%s\n' "$YELLOW" "$RESET"
fi

# ── 8b. Environment bootstrap seed (ADR-0072) ────────────────────────────────
# After migrations: project the manifest into the environment registry, seed
# provider_configs + OpenBao secrets, and generate the global system administrator
# handoff. Non-fatal: each step degrades honestly (skips if Postgres/OpenBao is
# unreachable) so the confidence ladder is never weakened by an optional substrate.
if [ "$STAGE_RESULT" -eq 0 ] && [ "$SEMANTIC_DEV" -eq 0 ]; then
    POSTGRES_URL="$_pg_url_m" make env-bootstrap-seed ENV="$STAGE" || \
        printf '%s⚠ env-bootstrap-seed reported issues (non-fatal)%s\n' "$YELLOW" "$RESET"
elif [ "$STAGE_RESULT" -eq 0 ]; then
    printf '%s↷ semantic-dev: skipping env-bootstrap Postgres/OpenBao seed%s\n' "$YELLOW" "$RESET"
fi

# ── 9. SonarQube quality gate (test stage only) ──────────────────────────────
# test is the gating stage: every issue must be clean before promoting to
# staging/prod.  The shared SonarQube instance token is auto-provisioned from
# scratch if needed, so this works on first-ever run after a DB reset.

if [ "$STAGE_RESULT" -eq 0 ] && [ "$STAGE" = "test" ]; then
    printf '%s▶ SonarQube quality gate (test stage)…%s\n' "$YELLOW" "$RESET"
    make sonar || STAGE_RESULT=1
fi

# ── 10. Test groups ────────────────────────────────────────────────────────────

# run-env-tests.sh exits 0 (FULL), 2 (DEGRADED), or other (FAILED). DEGRADED means
# ANY required contract-aware group could not be proven (ADR-ACT-0285 closure) — e.g.
# observability-correlation/failure-rootcause/sentry-assertion backends unreachable, a
# required Tempo trace not retrievable, OR real auth skipped at staging/prod. It is NOT
# auth-only and NOT a pass: recorded as "degraded" so verify-ladder rejects the ladder
# at EVERY stage (dev/test/staging/prod). The ladder still runs to completion for visibility.
STAGE_DEGRADED=0
if [ "$STAGE_RESULT" -eq 0 ] && [ -n "$REQUIRED_CSV" ]; then
    set +e
    bash scripts/tests/run-env-tests.sh "$STAGE" "$REQUIRED_CSV" "$EXCLUDED_CSV"
    _tests_rc=$?
    set -e
    if [ "$_tests_rc" -eq 2 ]; then
        STAGE_DEGRADED=1
    elif [ "$_tests_rc" -ne 0 ]; then
        STAGE_RESULT=1
    fi
fi

# ── (reserved — E2E coverage owned by policy test groups in step 10) ─────

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
if [ "$STAGE_RESULT" -ne 0 ]; then
    RESULT_STR="failed"
elif [ "$STAGE_DEGRADED" -eq 1 ]; then
    RESULT_STR="degraded"
fi

node scripts/evidence/write-stage-evidence.mjs \
    "$STAGE" "$RESULT_STR" "$START_TS" "$REQUIRED_CSV" "$EXCLUDED_CSV" \
    2>/dev/null || printf '%s⚠ evidence write failed (non-fatal)%s\n' "$YELLOW" "$RESET"

# ── 14. Exit ──────────────────────────────────────────────────────────────────

# Exit contract (ADR-ACT-0285 closure — honest, no process-result lie):
#   FAILED   → exit 1 ALWAYS (a real failure halts the ladder immediately).
#   DEGRADED → exit 2 by default, so a DIRECT `make stage-<stage>` returns a non-zero
#              process result for automation (a degraded required group is NOT a pass).
#              ONLY the orchestrator (all-promote) sets LADDER_CONTINUE_ON_DEGRADED=1 to
#              get exit 0 here — an EXPLICIT continuation mode so the whole ladder still
#              runs and verify-ladder (make evidence) sees every stage and fails on the
#              recorded DEGRADED. The stage never lies about its own process result.
#   FULL     → exit 0.
# shellcheck source=scripts/stages/stage-exit.sh
. "$(dirname "$0")/stage-exit.sh"
FINAL_RC="$(stage_exit_code "$STAGE_RESULT" "$STAGE_DEGRADED" "${LADDER_CONTINUE_ON_DEGRADED:-}")"
if [ "$STAGE_RESULT" -ne 0 ]; then
    printf '\n%s✗ stage:%s FAILED CONFIDENCE%s\n' "$RED" "$STAGE" "$RESET"
elif [ "$STAGE_DEGRADED" -eq 1 ] && [ "$FINAL_RC" = "0" ]; then
    printf '\n%s⚠ stage:%s DEGRADED CONFIDENCE — recorded; continuation mode (exit 0) so the ladder collects later stages; verify-ladder WILL fail%s\n' "$YELLOW" "$STAGE" "$RESET"
elif [ "$STAGE_DEGRADED" -eq 1 ]; then
    printf '\n%s⚠ stage:%s DEGRADED CONFIDENCE — exit 2 (a degraded required group never passes; set LADDER_CONTINUE_ON_DEGRADED=1 only in the orchestrator)%s\n' "$YELLOW" "$STAGE" "$RESET"
else
    printf '\n%s✓ stage:%s FULL CONFIDENCE%s\n' "$GREEN" "$STAGE" "$RESET"
fi
exit "$FINAL_RC"
