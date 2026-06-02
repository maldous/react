#!/usr/bin/env bash
set -euo pipefail
# Usage: run-env-tests.sh <STAGE> <REQUIRED_TESTS_CSV> [EXCLUDED_TESTS_CSV]
# Runs the test groups listed in REQUIRED_TESTS_CSV, skipping any in EXCLUDED_TESTS_CSV.

STAGE="${1:?STAGE required}"
REQUIRED="${2:?REQUIRED_TESTS_CSV required}"
EXCLUDED="${3:-}"

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

is_excluded() {
    local group="$1"
    echo "$EXCLUDED" | tr ',' '\n' | grep -qx "$group"
}

run_group() {
    local group="$1"

    if is_excluded "$group"; then
        printf '%s↷ skipping test group "%s" (excluded by policy)%s\n' "$YELLOW" "$group" "$RESET"
        return 0
    fi

    printf '\n%s▶ test group: %s%s\n' "$GREEN" "$group" "$RESET"

    _pg_port="$(grep -oP 'POSTGRES_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _pg_port="${_pg_port:-5433}"
    _rd_port="$(grep -oP 'REDIS_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _rd_port="${_rd_port:-6379}"
    _pg_url="postgresql://platform:platformpassword@localhost:${_pg_port}/platform"
    _rd_url="redis://localhost:${_rd_port}"

    case "$group" in
      minimal-smoke)
        bash scripts/smoke/http-smoke.sh "$STAGE"
        ;;
      unit)
        POSTGRES_URL="$_pg_url" REDIS_URL="$_rd_url" npm run test:platform-api
        npm run test:frontend:run
        ;;
      contract)
        npm run test:architecture
        ;;
      port)
        node tools/architecture/validate-compose-ports/src/index.mjs
        ;;
      interface)
        bash scripts/smoke/compose-smoke.sh "$STAGE"
        ;;
      compose-smoke)
        npm run test:compose
        ;;
      integration)
        make run-stage-tests ENV="$STAGE"
        ;;
      tenant)
        npx playwright test --config playwright.external.config.ts \
            e2e/external/tenant-prod.spec.ts
        ;;
      e2e-smoke)
        case "$STAGE" in
          dev|test)
            make e2e-internal ENV="$STAGE"
            ;;
          *)
            make e2e-external-smoke
            ;;
        esac
        ;;
      external-smoke)
        make e2e-external-smoke
        ;;
      auth-e2e)
        make e2e-external-auth
        ;;
      production-e2e)
        npm run test:e2e:prod
        ;;
      observability-smoke)
        bash scripts/smoke/observability-smoke.sh "$STAGE"
        ;;
      *)
        printf '%s⚠ unknown test group "%s" — skipping%s\n' "$YELLOW" "$group" "$RESET"
        ;;
    esac
}

IFS=',' read -ra GROUPS <<< "$REQUIRED"
for group in "${GROUPS[@]}"; do
    run_group "${group// /}"
done

printf '\n%s✓ all test groups complete for %s%s\n' "$GREEN" "$STAGE" "$RESET"
