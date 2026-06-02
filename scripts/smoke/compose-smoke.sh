#!/usr/bin/env bash
set -euo pipefail
# Usage: compose-smoke.sh <ENV>
# Verifies core Compose services are healthy for the given environment.

ENV="${1:?ENV required}"
COMPOSE_CMD="docker/compose-wrapper.sh ${ENV}"
GREEN=$(tput setaf 2 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)
ERRORS=0

check_service() {
    local name="$1"
    if $COMPOSE_CMD ps "$name" 2>/dev/null | grep -qE "healthy|Up"; then
        printf '%s✓ %s healthy%s\n' "$GREEN" "$name" "$RESET"
    else
        printf '%s✗ %s not healthy%s\n' "$RED" "$name" "$RESET"
        ERRORS=$((ERRORS + 1))
    fi
}

for svc in postgres redis; do
    check_service "$svc"
done

[ "$ERRORS" -gt 0 ] && { printf '%s✗ %d service(s) not healthy for %s%s\n' "$RED" "$ERRORS" "$ENV" "$RESET"; exit 1; }
printf '%s✓ compose smoke passed for %s%s\n' "$GREEN" "$ENV" "$RESET"
