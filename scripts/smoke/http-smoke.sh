#!/usr/bin/env bash
set -euo pipefail
# Usage: http-smoke.sh <ENV>
# Smoke-tests platform-api HTTP endpoints for the given environment.

ENV="${1:?ENV required}"
RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

_port="$(grep -oP 'PLATFORM_API_PORT=\K\d+' ".env.${ENV}" 2>/dev/null | head -1 || true)"
_port="${_port:-3001}"
BASE="http://localhost:${_port}"
ERRORS=0

check_url() {
    local url="$1" expected_status="${2:-200}"
    local actual
    actual="$(curl -o /dev/null -s -w '%{http_code}' --max-time 10 "${url}")"
    if [ "$actual" = "$expected_status" ]; then
        printf '%s✓ %s → %s%s\n' "$GREEN" "$url" "$actual" "$RESET"
    else
        printf '%s✗ %s → %s (expected %s)%s\n' "$RED" "$url" "$actual" "$expected_status" "$RESET"
        ERRORS=$((ERRORS + 1))
    fi
}

check_url "${BASE}/healthz"
check_url "${BASE}/readyz"
check_url "${BASE}/version"

[ "$ERRORS" -gt 0 ] && { printf '%s✗ http smoke failed for %s (%d errors)%s\n' "$RED" "$ENV" "$ERRORS" "$RESET"; exit 1; }
printf '%s✓ http smoke passed for %s%s\n' "$GREEN" "$ENV" "$RESET"
