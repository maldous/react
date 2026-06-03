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

    # Derive all service ports from .env.${STAGE} — never fall through to root .env defaults.
    _pg_port="$(grep -oP 'POSTGRES_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _pg_port="${_pg_port:-5433}"
    _rd_port="$(grep -oP 'REDIS_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _rd_port="${_rd_port:-6379}"
    _minio_port="$(grep -oP 'MINIO_API_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _minio_port="${_minio_port:-9000}"
    _ch_port="$(grep -oP 'CLICKHOUSE_HTTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _ch_port="${_ch_port:-8124}"
    _mp_ui_port="$(grep -oP 'MAILPIT_UI_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _mp_ui_port="${_mp_ui_port:-8025}"
    _mp_smtp="$(grep -oP 'MAILPIT_SMTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _mp_smtp="${_mp_smtp:-1025}"
    _mp_root="$(grep -oP 'MAILPIT_ROOT_URL=\K\S+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _mp_root="${_mp_root:-/mailpit}"
    # Use explicit MAILPIT_API from env file if defined; otherwise compose from UI port + webroot.
    _mp_api="$(grep -oP 'MAILPIT_API=\K\S+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _mp_api="${_mp_api:-http://localhost:${_mp_ui_port}${_mp_root}}"
    _otel_http="$(grep -oP 'OTEL_HTTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1)"
    _otel_http="${_otel_http:-4318}"
    _pg_url="postgresql://platform:platformpassword@localhost:${_pg_port}/platform"
    _pg_app_url="postgresql://platform_app:platformapppassword@localhost:${_pg_port}/platform"
    _rd_url="redis://localhost:${_rd_port}"

    case "$group" in
      minimal-smoke)
        bash scripts/smoke/http-smoke.sh "$STAGE"
        ;;
      unit)
        POSTGRES_URL="$_pg_url" POSTGRES_APP_URL="$_pg_app_url" REDIS_URL="$_rd_url" npm run test:platform-api
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
        POSTGRES_URL="$_pg_url" \
        POSTGRES_APP_URL="$_pg_app_url" \
        REDIS_URL="$_rd_url" \
        COMPOSE_PROJECT="$STAGE" \
        MINIO_ENDPOINT="http://localhost:${_minio_port}" \
        CLICKHOUSE_HTTP="http://localhost:${_ch_port}" \
        MAILPIT_API="${_mp_api}" \
        MAILPIT_SMTP_PORT="${_mp_smtp}" \
        OTEL_HTTP="http://localhost:${_otel_http}" \
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
          dev)
            make e2e-internal ENV="$STAGE"
            ;;
          test)
            # Kill stale platform-api and Vite processes to ensure Playwright starts
            # fresh with the correct env vars (avoid reuseExistingServer picking up
            # stale processes from a previous stage with wrong configuration).
            lsof -ti:3001,3012,5173,5183 2>/dev/null | xargs -r kill -9 2>/dev/null || true
            sleep 1
            # Use separate ports to avoid conflict with compose-started platform-api (port 3002)
            PLATFORM_API_PORT=3012 APP_PORT=5183 \
              LOCAL_FIXTURE_SESSION=tenant-admin \
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

while IFS= read -r group; do
    run_group "$group"
done < <(printf '%s' "$REQUIRED" | tr ',' '\n')

printf '\n%s✓ all test groups complete for %s%s\n' "$GREEN" "$STAGE" "$RESET"
