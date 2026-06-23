#!/usr/bin/env bash
set -euo pipefail
# Usage: run-env-tests.sh <STAGE> <REQUIRED_TESTS_CSV> [EXCLUDED_TESTS_CSV]
# Runs the test groups listed in REQUIRED_TESTS_CSV, skipping any in EXCLUDED_TESTS_CSV.

STAGE="${1:?STAGE required}"
REQUIRED="${2:?REQUIRED_TESTS_CSV required}"
EXCLUDED="${3:-}"

# ADR-0072: resolve the generated runtime env (.env/<stage>.env from the manifest)
# once; all port/url derivation below reads from it. Legacy .env.<stage> is a fallback.
_ENVF="$(bash "$(dirname "$0")/../env/resolve-env-file.sh" "$STAGE" 2>/dev/null || echo ".env.${STAGE}")"

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# ADR-ACT-0285 (closure) — explicit, honest confidence. A stage run is FULL only when
# EVERY required group is proven. DEGRADED means ANY required contract-aware group exited
# 2 (could not be proven) — observability-correlation (Loki completeness / required Tempo
# trace), failure-rootcause, sentry-assertion, OR the auth-e2e gate. It is NOT auth-only and
# NEVER passes promotion at any stage. FAILED means a required group failed (incl. a missing
# required scenario or a Tempo trace that exists in Loki but not Tempo). E2E_DEGRADED is set
# whenever a contract-aware group exits 2; the script then exits 2 so run-stage.sh records
# the stage as "degraded" and verify-ladder fails the ladder.
E2E_DEGRADED=0

confidence() {
    local level="$1"
    shift
    local color="$GREEN"
    case "$level" in
        DEGRADED) color="$YELLOW" ;;
        FAILED) color="$RED" ;;
    esac
    printf '%s================ %s CONFIDENCE [%s] ================%s\n' "$color" "$level" "$STAGE" "$RESET"
    printf '%s  %s%s\n' "$color" "$*" "$RESET"
    printf '%s====================================================%s\n' "$color" "$RESET"
}

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
    _pg_port="$(grep -oP 'POSTGRES_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _pg_port="${_pg_port:-5433}"
    _rd_port="$(grep -oP 'REDIS_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _rd_port="${_rd_port:-6379}"
    _minio_port="$(grep -oP 'MINIO_API_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _minio_port="${_minio_port:-9000}"
    _ch_port="$(grep -oP 'CLICKHOUSE_HTTP_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _ch_port="${_ch_port:-8124}"
    _mp_ui_port="$(grep -oP 'MAILPIT_UI_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _mp_ui_port="${_mp_ui_port:-8025}"
    _mp_smtp="$(grep -oP 'MAILPIT_SMTP_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _mp_smtp="${_mp_smtp:-1025}"
    _mp_root="$(grep -oP 'MAILPIT_ROOT_URL=\K\S+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _mp_root="${_mp_root:-/mailpit}"
    # Use explicit MAILPIT_API from env file if defined; otherwise compose from UI port + webroot.
    _mp_api="$(grep -oP 'MAILPIT_API=\K\S+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _mp_api="${_mp_api:-http://localhost:${_mp_ui_port}${_mp_root}}"
    _otel_http="$(grep -oP 'OTEL_HTTP_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
    _otel_http="${_otel_http:-4318}"
    _pg_url="postgresql://platform:platformpassword@localhost:${_pg_port}/platform"
    _pg_app_url="postgresql://platform_app:platformapppassword@localhost:${_pg_port}/platform"
    _rd_url="redis://localhost:${_rd_port}"
    # For staging/prod: use APP_BASE_URL from the env file so E2E tests exercise
    # the real external domain (staging.aldous.info / aldous.info via Cloudflare).
    # For dev/test: use localhost:WEB_HTTP_PORT — no external DNS dependency needed.
    if [ "$STAGE" = "staging" ] || [ "$STAGE" = "prod" ]; then
        _app_url="$(grep -oP 'APP_BASE_URL=\K\S+' "$_ENVF" 2>/dev/null | head -1 || true)"
    fi
    if [ -z "${_app_url:-}" ]; then
        _web_port="$(grep -oP 'WEB_HTTP_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
        _app_url="http://localhost:${_web_port:-80}"
    fi

    case "$group" in
      minimal-smoke)
        bash scripts/smoke/http-smoke.sh "$STAGE"
        ;;
      e2e-coverage-validate)
        # ADR-0075 / ADR-ACT-0285 — stage-aware E2E coverage gate. Fails when a
        # delivered/locally-proven capability, admin route, nav item, clickthrough
        # entry, role, accessibility profile, or UI surface has no declared E2E
        # coverage (minus honest exemptions). Pure registry validation.
        STAGE="$STAGE" node tools/e2e/validate-e2e/src/index.mjs all
        # ADR-ACT-0285 (closure) — canonical scenario-manifest gate. Fails when a test
        # has no scenario/dynamic/exemption, a scenario id is duplicated/orphaned/title-
        # derived, a scenario's stage is incompatible with its suite, or an expected
        # observability field is invalid. e2e/scenario-manifest.json is the single source
        # of truth for correlatable scenarios.
        STAGE="$STAGE" node tools/e2e/validate-scenario-manifest/src/index.mjs
        ;;
      e2e-observability-correlation)
        # ADR-ACT-0285 Phase 3 — prove E2E scenarios are findable in the logs by
        # testRunId/scenarioId (and Tempo when delivered). Honest: DEGRADED when
        # backends unreachable / no E2E_TEST_RUN_ID; FAILED only when a known run
        # produced zero correlatable lines. Never silently passes.
        STAGE="$STAGE" node tools/e2e/observability-correlation/src/index.mjs
        ;;
      e2e-clickability)
        # ADR-ACT-0285 Phase 4 / ADR-0075 — dynamic clickability crawler. Discovers
        # clickable surfaces by accessible role, safely crawls same-origin routes,
        # and quality-gates each page (landmark/h1/no-console-error/not-blank) +
        # diffs vs the UI contract. Runs against the stage web URL.
        PROD_BASE_URL="$_app_url" E2E_STAGE="$STAGE" \
            npx playwright test --config playwright.discovery.config.ts
        ;;
      e2e-failure-rootcause)
        # ADR-ACT-0285 Phase 5 — failure-path/root-cause + Grafana-Loki validation.
        # Triggers a denial, proves it is root-causeable in Loki (reason+requestId+
        # traceId), and enforces the no-high-cardinality-labels policy. Honest
        # DEGRADED when backends unreachable; FAILED on a non-root-causeable failure
        # or a forbidden label.
        STAGE="$STAGE" node tools/e2e/failure-rootcause/src/index.mjs
        ;;
      e2e-sentry-assertion)
        # ADR-ACT-0285 Phase 5.5 — self-hosted Sentry API event assertion. Triggers
        # the gated synthetic-failure endpoint, then queries the Sentry API to prove
        # the event was captured with environment/release/requestId/traceId +
        # testRunId/scenarioId tags (and a prod no-unexpected-events gate). Honest
        # DEGRADED when Sentry is unconfigured/unreachable; FAILED when reachable but
        # the event is missing or has wrong metadata.
        STAGE="$STAGE" node tools/e2e/sentry-assertion/src/index.mjs
        ;;
      e2e-accessibility)
        # ADR-ACT-0285 Phase 6 — axe-core WCAG across safe routes x a11y profiles.
        PROD_BASE_URL="$_app_url" E2E_STAGE="$STAGE" \
            npx playwright test --config playwright.discovery.config.ts e2e/discovery/accessibility.spec.ts
        ;;
      e2e-persona-authz)
        # ADR-ACT-0285 Phase 6 — persona authorization permutation (forbidden
        # routes/APIs denied, expected allowed). E2E_PERSONA selects the persona.
        PROD_BASE_URL="$_app_url" E2E_STAGE="$STAGE" \
            npx playwright test --config playwright.discovery.config.ts e2e/discovery/persona-authz.spec.ts
        ;;
      e2e-persona-matrix)
        # ADR-ACT-0285 Phase 6 sub-project A — multi-persona authed crawl: every
        # stage-applicable persona logs in and the full registry matrix is asserted
        # (routes + APIs + clickthrough allow/deny). Real personas degrade honestly
        # (recorded, non-blocking) when KEYCLOAK_TEST_* creds are absent.
        PROD_BASE_URL="$_app_url" E2E_STAGE="$STAGE" \
            npx playwright test --config playwright.discovery.config.ts e2e/discovery/persona-matrix.spec.ts
        ;;
      unit)
        if [ "$STAGE" = "dev" ] && { [ "${USF_PROVIDER_MODE:-semantic-dev}" = "semantic-dev" ] || [ "${USF_PROVIDER_MODE:-semantic-dev}" = "in-memory" ]; }; then
            USF_PROVIDER_MODE=compose \
            LOCAL_FIXTURE_SESSION=unauthenticated \
            AUTH_PROVIDER_MODE="${AUTH_PROVIDER_MODE:-disabled}" \
            SECRET_STORE_PROVIDER="${SECRET_STORE_PROVIDER:-builtin}" \
            TENANT_SECRET_ENCRYPTION_KEY="${TENANT_SECRET_ENCRYPTION_KEY:-00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff}" \
            WEBHOOK_WORKER_DISABLED=true \
            V1C12B_RETENTION_TICK_DISABLED=true \
            npm run test:platform-api:unit-safe
        else
            POSTGRES_URL="$_pg_url" POSTGRES_APP_URL="$_pg_app_url" REDIS_URL="$_rd_url" npm run test:platform-api
        fi
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
        npm run test:compose || return 1
        # compose-smoke resets the DB on destructive stages (dev/test) and seeds the
        # RLS-isolation fixtures (rls-org-a/b), which removes the boot-seeded
        # fixture-org. The E2E groups that follow (e2e-smoke + discovery) drive the
        # fixture session (fixture-org), so restore the fixture seed before they run.
        # preserve stages (staging/prod) skip the reset, so they are never re-seeded.
        # (Runs only after test:compose succeeded — the `|| return 1` above
        # propagates a compose-smoke failure as a real FAILED group.)
        if [ "$_data_policy" = "destructive" ]; then
            printf '%s▶ restoring fixture seed after destructive compose-smoke%s\n' "$GREEN" "$RESET"
            POSTGRES_URL="$_pg_url" npm run db:seed || return 1
        fi
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
            return 1
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
        # ADR-ACT-0285 Phase 2 — real-auth confidence gate (staging/prod only).
        # FULL requires KEYCLOAK_TEST_USERNAME + KEYCLOAK_TEST_PASSWORD AND a real
        # domain (Keycloak's redirect cannot complete against localhost). Missing
        # creds = hard FAILED (the gate is never silently skipped). localhost with
        # creds = DEGRADED only when ALLOW_SKIP_AUTH_E2E=1 (manual local ladder);
        # DEGRADED never passes promotion (verify-ladder rejects it). Direct
        # stage runs without the flag hard-fail. dev/test use fixture auth and
        # never include this group.
        _missing=""
        [ -z "${KEYCLOAK_TEST_USERNAME:-}" ] && _missing="KEYCLOAK_TEST_USERNAME"
        [ -z "${KEYCLOAK_TEST_PASSWORD:-}" ] && _missing="${_missing:+$_missing, }KEYCLOAK_TEST_PASSWORD"
        # Routed through the shared contract: FULL→return 0, FAILED→return 1,
        # DEGRADED→return 2 (the loop records E2E_DEGRADED — no auth-only special-case).
        if [ -n "$_missing" ]; then
            confidence FAILED "real-auth E2E cannot run — missing $_missing. staging/prod cannot pass without real auth (docs/local-development/real-login-e2e.md)."
            return 1
        fi
        if echo "$_app_url" | grep -q "localhost"; then
            if [ "${ALLOW_SKIP_AUTH_E2E:-}" = "1" ]; then
                confidence DEGRADED "real-auth E2E skipped — $_app_url is localhost; Keycloak redirect needs real DNS. Run PROD_BASE_URL=<real-domain> for FULL. This stage will NOT pass promotion."
                return 2
            fi
            confidence FAILED "real-auth E2E cannot run against localhost ($_app_url). Run PROD_BASE_URL=https://aldous.info make stage-$STAGE for the real Keycloak redirect."
            return 1
        fi
        if PROD_BASE_URL="$_app_url" make e2e-external-auth; then
            confidence FULL "real-auth E2E passed against $_app_url"
            return 0
        fi
        confidence FAILED "real-auth E2E run failed against $_app_url"
        return 1
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
        return 1
        ;;
    esac
}

# `|| [ -n "$group" ]` is REQUIRED: REQUIRED_CSV is comma-joined with no trailing
# newline, so a plain `while read` silently drops the LAST group (pre-existing bug
# that skipped each stage's final test group, e.g. prod production-e2e). Fixed here
# so every required group — including the auth-e2e confidence gate — actually runs.

# ADR-ACT-0285 Phase 3 — ONE shared correlation id for the whole stage run. The
# Playwright groups stamp it on their platform-api requests (via
# e2e/support/correlation.ts → x-e2e-test-run-id) and the later
# e2e-observability-correlation harness queries Loki for the SAME id. Generated once
# here and exported so every group's child process (make → playwright, node tools)
# inherits it. Honours a pre-set value (caller/CI) for reproducibility.
if [ -z "${E2E_TEST_RUN_ID:-}" ]; then
    E2E_TEST_RUN_ID="run-${STAGE}-$(date +%s)-$(openssl rand -hex 4 2>/dev/null || printf '%04x%04x' "$RANDOM" "$RANDOM")"
fi
export E2E_TEST_RUN_ID
export E2E_STAGE="$STAGE"
printf '%s▶ correlation: E2E_TEST_RUN_ID=%s (stage %s)%s\n' "$GREEN" "$E2E_TEST_RUN_ID" "$STAGE" "$RESET"

# Honest confidence aggregation (ADR-ACT-0285). classify_group_rc maps each group's
# exit code to OK | DEGRADED | FAIL using the shared contract: only contract-aware
# groups (observability tools + auth-e2e) may DEGRADE via exit 2; every other group
# is pass/fail (any non-zero — incl. make's 2-on-failure — is a FAILURE). Sourced so
# the same logic is unit-tested in scripts/tests/tests/aggregate-confidence.test.mjs.
# shellcheck source=scripts/tests/aggregate-confidence.sh
. "$(dirname "$0")/aggregate-confidence.sh"

while IFS= read -r group || [ -n "$group" ]; do
    [ -z "$group" ] && continue
    # Capture the group's exit code WITHOUT aborting (set -e is suppressed by `||`).
    _rc=0
    run_group "$group" || _rc=$?
    case "$(classify_group_rc "$group" "$_rc")" in
        OK) ;;
        DEGRADED)
            E2E_DEGRADED=1
            printf '%s⚠ required group %s DEGRADED (exit 2) — recorded; stage will NOT pass promotion%s\n' "$YELLOW" "$group" "$RESET"
            ;;
        FAIL)
            printf '%s✗ required group %s FAILED (exit %s) — failing stage immediately%s\n' "$RED" "$group" "$_rc" "$RESET"
            exit 1
            ;;
    esac
done < <(printf '%s' "$REQUIRED" | tr ',' '\n')

if [ "$E2E_DEGRADED" = "1" ]; then
    printf '\n%s⚠ %s completed with DEGRADED confidence — a required group exited 2 (DEGRADED); does NOT pass promotion%s\n' "$YELLOW" "$STAGE" "$RESET"
    exit 2
fi

printf '\n%s✓ all required groups passed for %s — FULL confidence%s\n' "$GREEN" "$STAGE" "$RESET"
exit 0
