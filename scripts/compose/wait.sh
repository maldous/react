#!/usr/bin/env bash
set -euo pipefail
# Usage: wait.sh <ENV> [TIMEOUT_SECONDS]
# Polls platform-api /healthz until healthy or timeout.

ENV="${1:?ENV required}"
TIMEOUT="${2:-120}"
RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

_ENVF="$(bash "$(dirname "$0")/../env/resolve-env-file.sh" "$ENV" 2>/dev/null || echo ".env.${ENV}")"
_api_port="$(grep -oP 'PLATFORM_API_PORT=\K\d+' "$_ENVF" 2>/dev/null | head -1 || true)"
_api_port="${_api_port:-3001}"
_url="http://localhost:${_api_port}/healthz"

printf 'Waiting for platform-api at %s (timeout %ss)...\n' "$_url" "$TIMEOUT"

timeout "$TIMEOUT" bash -c \
    "until curl -fsS '${_url}' >/dev/null 2>&1; do sleep 2; done" \
    || { printf '%s✗ platform-api not healthy after %ss at %s%s\n' \
             "$RED" "$TIMEOUT" "$_url" "$RESET"
         exit 1; }

printf '%s✓ platform-api healthy at %s%s\n' "$GREEN" "$_url" "$RESET"
