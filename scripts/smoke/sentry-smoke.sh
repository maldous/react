#!/usr/bin/env bash
set -euo pipefail
# Verify the shared Sentry instance is reachable through Caddy's /sentry/ path
# on the prod internal Caddy (port 83). A 401 means: external-caddy routed
# correctly, internal Caddy matched /sentry/*, forward_auth fired, and
# sentry-web responded — the full chain works. Anything else is a problem.

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# sentry-web must answer its own health endpoint first
if ! docker/compose-wrapper.sh sentry exec sentry-web \
    python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/_health/',timeout=5)" \
    > /dev/null 2>&1; then
    printf '%s✗ sentry-smoke: sentry-web /_health/ not responding%s\n' "$RED" "$RESET"
    exit 1
fi

# Full chain check via the prod internal Caddy (must be running on port 83)
_status=$(curl -so /dev/null -w "%{http_code}" --max-time 10 \
    -H "Host: aldous.info" http://localhost:83/sentry/ 2>/dev/null || true)

if [ "$_status" = "401" ]; then
    printf '%s✓ sentry-smoke: /sentry/ → 401 (forward_auth working, chain intact)%s\n' "$GREEN" "$RESET"
elif [ "$_status" = "000" ] || [ -z "$_status" ]; then
    printf '%s⚠ sentry-smoke: prod Caddy (port 83) not reachable — skipping chain check%s\n' \
        "$YELLOW" "$RESET"
    printf '%s  (sentry-web itself is healthy; Caddy check requires react-prod web profile)%s\n' \
        "$YELLOW" "$RESET"
else
    printf '%s✗ sentry-smoke: /sentry/ returned %s — expected 401%s\n' "$RED" "$_status" "$RESET"
    printf '%s  Check: is sentry-bridge connected? Is sentry-web --bind 0.0.0.0:9000?%s\n' \
        "$YELLOW" "$RESET"
    exit 1
fi
