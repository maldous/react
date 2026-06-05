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
    # Each grep uses "|| true" so a missing key never triggers set -euo pipefail exit.
    _pg_port="$(grep -oP 'POSTGRES_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _pg_port="${_pg_port:-5433}"
    _rd_port="$(grep -oP 'REDIS_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _rd_port="${_rd_port:-6379}"
    _minio_port="$(grep -oP 'MINIO_API_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _minio_port="${_minio_port:-9000}"
    _ch_port="$(grep -oP 'CLICKHOUSE_HTTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _ch_port="${_ch_port:-8124}"
    _mp_ui_port="$(grep -oP 'MAILPIT_UI_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _mp_ui_port="${_mp_ui_port:-8025}"
    _mp_smtp="$(grep -oP 'MAILPIT_SMTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _mp_smtp="${_mp_smtp:-1025}"
    _mp_root="$(grep -oP 'MAILPIT_ROOT_URL=\K\S+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _mp_root="${_mp_root:-/mailpit}"
    # Use explicit MAILPIT_API from env file if defined; otherwise compose from UI port + webroot.
    _mp_api="$(grep -oP 'MAILPIT_API=\K\S+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _mp_api="${_mp_api:-http://localhost:${_mp_ui_port}${_mp_root}}"
    _otel_http="$(grep -oP 'OTEL_HTTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    _otel_http="${_otel_http:-4318}"
    _pg_url="postgresql://platform:platformpassword@localhost:${_pg_port}/platform"
    _pg_app_url="postgresql://platform_app:platformapppassword@localhost:${_pg_port}/platform"
    _rd_url="redis://localhost:${_rd_port}"
    # For staging/prod: use APP_BASE_URL from the env file so E2E tests exercise
    # the real external domain (staging.aldous.info / aldous.info via Cloudflare).
    # For dev/test: use localhost:WEB_HTTP_PORT — no external DNS dependency needed.
    if [ "$STAGE" = "staging" ] || [ "$STAGE" = "prod" ]; then
        _app_url="$(grep -oP 'APP_BASE_URL=\K\S+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
    fi
    if [ -z "${_app_url:-}" ]; then
        _web_port="$(grep -oP 'WEB_HTTP_PORT=\K\d+' ".env.${STAGE}" 2>/dev/null | head -1 || true)"
        _app_url="http://localhost:${_web_port:-80}"
    fi

    case "$group" in
      minimal-smoke)
        bash scripts/smoke/http-smoke.sh "$STAGE"
        ;;
      unit)
        POSTGRES_URL="$_pg_url" POSTGRES_APP_URL="$_pg_app_url" REDIS_URL="$_rd_url" npm run test:platform-api
        NODE_ENV=test npm run test:frontend:run
        ;;

      contract)
        POSTGRES_URL="$_pg_url" POSTGRES_APP_URL="$_pg_app_url" REDIS_URL="$_rd_url" \
        npm run test:architecture
        ;;
      port)
        node tools/architecture/validate-compose-ports/src/index.mjs
        ;;
      interface)
        bash scripts/smoke/compose-smoke.sh "$STAGE"
        ;;
      compose-smoke)
        # Pass DATA_POLICY so compose-smoke.test.mjs skips resetDatabase() on
        # staging/prod — never truncate real data in preserve environments.
        _data_policy="destructive"
        [ "$STAGE" = "staging" ] || [ "$STAGE" = "prod" ] && _data_policy="preserve"
        # COMPOSE_PROJECT: container name prefix used by compose-smoke to inspect health.
        # Dev Tilt containers use project "react" (e.g. react-postgres-1).
        # All others use the react-<env> project name from compose-wrapper.sh.
        _compose_proj="react-${STAGE}"
        [ "$STAGE" = "dev" ] && _compose_proj="react"
        POSTGRES_URL="$_pg_url" \
        POSTGRES_APP_URL="$_pg_app_url" \
        REDIS_URL="$_rd_url" \
        COMPOSE_PROJECT="$_compose_proj" \
        DATA_POLICY="$_data_policy" \
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
        # Guard: the apex domain must be reachable via the real origin (Cloudflare → external-caddy).
        # A 521 here means external-caddy is not running — likely killed by a prior compose-down-reset.
        _tenant_base="$(echo "$_app_url" | sed 's|^https://aldous\.info.*|https://aldous.info|;s|^http://staging\.aldous\.info.*|http://staging.aldous.info|')"
        if ! curl -fsS --max-time 15 "${_tenant_base}/healthz" > /dev/null 2>&1; then
            printf '%s✗ tenant E2E guard: %s/healthz not reachable — is external-caddy running?%s\n' \
                "$RED" "$_tenant_base" "$RESET"
            printf '%s  Run: make external-caddy-up%s\n' "$YELLOW" "$RESET"
            exit 1
        fi
        PROD_BASE_URL="$_app_url" npx playwright test --config playwright.external.config.ts \
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
            PROD_BASE_URL="$_app_url" make e2e-external-smoke
            ;;
        esac
        ;;
      external-smoke)
        PROD_BASE_URL="$_app_url" make e2e-external-smoke
        ;;
      auth-e2e)
        # auth-e2e requires a real KC redirect flow — only works when PROD_BASE_URL
        # is a real domain (not localhost).
        #
        # Default (no ALLOW_SKIP_AUTH_E2E): prod hard-fails when localhost so the
        # gate is never silently dropped. Set ALLOW_SKIP_AUTH_E2E=1 to skip with a
        # prominent warning — make all sets this so the local confidence ladder works.
        # Direct 'make stage-prod' without the var enforces the full gate.
        if echo "$_app_url" | grep -q "localhost"; then
            if [ "$STAGE" = "prod" ] && [ "${ALLOW_SKIP_AUTH_E2E:-}" != "1" ]; then
                printf '%s✗ auth-e2e cannot run: PROD_BASE_URL=%s is localhost%s\n' \
                    "$RED" "$_app_url" "$RESET"
                printf '%s  Prod requires real KC redirect. Options:%s\n' "$YELLOW" "$RESET"
                printf '%s  1. Run against real DNS: PROD_BASE_URL=https://aldous.info make stage-prod%s\n' \
                    "$YELLOW" "$RESET"
                printf '%s  2. Local confidence ladder: make all  (sets ALLOW_SKIP_AUTH_E2E=1)%s\n' \
                    "$YELLOW" "$RESET"
                exit 1
            fi
            if [ "$STAGE" = "prod" ]; then
                printf '%s⚠ auth-e2e SKIPPED (prod, ALLOW_SKIP_AUTH_E2E=1) — PROD_BASE_URL=%s is localhost%s\n' \
                    "$YELLOW" "$_app_url" "$RESET"
                printf '%s  KC redirect requires real DNS. To run the full gate: PROD_BASE_URL=https://aldous.info make stage-prod%s\n' \
                    "$YELLOW" "$RESET"
            else
                printf '%s↷ auth-e2e skipped — PROD_BASE_URL=%s is localhost%s\n' \
                    "$YELLOW" "$_app_url" "$RESET"
            fi
        else
            PROD_BASE_URL="$_app_url" make e2e-external-auth
        fi
        ;;
      production-e2e)
        PROD_BASE_URL="$_app_url" npm run test:e2e:prod
        ;;
      observability-smoke)
        bash scripts/smoke/observability-smoke.sh "$STAGE"
        ;;
      *)
        printf '%s✗ unknown test group "%s" — check stage-policy.yaml for typos%s\n' \
            "$RED" "$group" "$RESET"
        exit 1
        ;;
    esac
}

while IFS= read -r group; do
    run_group "$group"
done < <(printf '%s' "$REQUIRED" | tr ',' '\n')

printf '\n%s✓ all test groups complete for %s%s\n' "$GREEN" "$STAGE" "$RESET"
