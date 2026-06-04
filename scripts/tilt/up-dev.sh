#!/usr/bin/env bash
set -euo pipefail
# Starts Tilt in the background, writes PID to .tilt.pid,
# then blocks until platform-api and Vite dev server are healthy.
# Exit 0 = both healthy. Exit 1 = timeout or Tilt crash.

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

_api_port="$(grep -oP 'PLATFORM_API_PORT=\K\d+' .env.dev 2>/dev/null | head -1 || true)"
_api_port="${_api_port:-3001}"

die() {
    printf '%s✗ %s%s\n' "$RED" "$1" "$RESET"
    bash scripts/tilt/down-dev.sh 2>/dev/null || true
    exit 1
}

# Idempotency check — skip restart if Tilt is already running and healthy.
# Supports persistent model where all environments remain running after validation.
if pgrep -f 'tilt up' >/dev/null 2>&1; then
    if curl -fsS "http://localhost:${_api_port}/healthz" >/dev/null 2>&1 && \
       curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
        printf '%s✓ Tilt already running and healthy — skipping startup%s\n' "$GREEN" "$RESET"
        exit 0
    fi
fi

# Kill any stale Tilt process that might be holding port 10350
if pkill -f 'tilt up' 2>/dev/null; then
    printf 'Killed stale Tilt process...\n'
    # Wait for port 10350 to be released (up to 15s)
    timeout 15 bash -c 'while ss -tlnp "sport = :10350" 2>/dev/null | grep -q .; do sleep 1; done' 2>/dev/null || true
fi

printf 'Starting Tilt...\n'
# Redirect Tilt stdout/stderr to a dedicated log so it does not inherit the
# parent process's stdout. Without this, `make all > all.txt 2>&1` (or any
# pipe/redirect) keeps the fd open indefinitely — Tilt streams container logs
# forever, blocking the shell waiting for EOF after Make has already finished.
tilt up > .tilt.log 2>&1 &
echo $! > .tilt.pid

# 360s: postgres initialises from scratch while SonarQube, Sentry, and Keycloak
# all compete for it concurrently. Observed startup time ~225s on this machine.
printf 'Waiting for platform-api at http://localhost:%s/healthz (up to 360s)...\n' "$_api_port"
timeout 360 bash -c "
    _pid=\$(cat .tilt.pid 2>/dev/null)
    until curl -fsS http://localhost:${_api_port}/healthz >/dev/null 2>&1; do
        kill -0 \"\$_pid\" 2>/dev/null || { printf '${RED}✗ Tilt exited unexpectedly${RESET}\n'; exit 1; }
        sleep 2
    done
" || die "platform-api not healthy after 360s"

printf 'Waiting for Vite dev server at http://localhost:5173/ (up to 360s)...\n'
timeout 360 bash -c \
    "until curl -fsS http://localhost:5173/ >/dev/null 2>&1; do sleep 2; done" \
    || die "Vite dev server not healthy after 360s"

printf '%s✓ Tilt dev stack healthy (API + Vite)%s\n' "$GREEN" "$RESET"
