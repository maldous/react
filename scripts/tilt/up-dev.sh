#!/usr/bin/env bash
set -euo pipefail
# Starts Tilt in the background, writes PID to .tilt.pid,
# then blocks until platform-api and Vite dev server are healthy.
# Exit 0 = both healthy. Exit 1 = timeout or Tilt crash.

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

_api_port="$(grep -oP 'PLATFORM_API_PORT=\K\d+' .env.dev 2>/dev/null | head -1)"
_api_port="${_api_port:-3001}"

die() {
    printf '%s✗ %s%s\n' "$RED" "$1" "$RESET"
    bash scripts/tilt/down-dev.sh 2>/dev/null || true
    exit 1
}

printf 'Starting Tilt...\n'
tilt up &
echo $! > .tilt.pid

printf 'Waiting for platform-api at http://localhost:%s/healthz (up to 120s)...\n' "$_api_port"
timeout 120 bash -c "
    _pid=\$(cat .tilt.pid 2>/dev/null)
    until curl -fsS http://localhost:${_api_port}/healthz >/dev/null 2>&1; do
        kill -0 \"\$_pid\" 2>/dev/null || { printf '${RED}✗ Tilt exited unexpectedly${RESET}\n'; exit 1; }
        sleep 2
    done
" || die "platform-api not healthy after 120s"

printf 'Waiting for Vite dev server at http://localhost:5173/ (up to 120s)...\n'
timeout 120 bash -c \
    "until curl -fsS http://localhost:5173/ >/dev/null 2>&1; do sleep 2; done" \
    || die "Vite dev server not healthy after 120s"

printf '%s✓ Tilt dev stack healthy (API + Vite)%s\n' "$GREEN" "$RESET"
