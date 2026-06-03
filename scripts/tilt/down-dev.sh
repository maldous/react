#!/usr/bin/env bash
set -euo pipefail
# Tears down Tilt, waits for the process to exit, removes .tilt.pid.

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

if [ -f .tilt.pid ]; then
    _pid="$(cat .tilt.pid)"
else
    printf '%s⚠ .tilt.pid not found — trying pgrep%s\n' "$YELLOW" "$RESET"
    _pid="$(pgrep -f 'tilt' 2>/dev/null | head -1 || true)"
fi

tilt down 2>/dev/null || true

if [ -n "${_pid:-}" ]; then
    wait "$_pid" 2>/dev/null || true
fi

# Poll until tilt process is gone (up to 30s)
timeout 30 bash -c \
    "while pgrep -f 'tilt' >/dev/null 2>&1; do sleep 1; done" || true

rm -f .tilt.pid
printf '%s✓ Tilt stopped%s\n' "$GREEN" "$RESET"
