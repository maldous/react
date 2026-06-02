#!/usr/bin/env bash
set -euo pipefail
# Verifies Docker daemon is running and Docker Compose v2 plugin is available.

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# Daemon running?
docker info >/dev/null 2>&1 \
    || { printf '%s✗ Docker daemon is not running%s\n' "$RED" "$RESET"; exit 1; }
printf '%s✓ Docker daemon running%s\n' "$GREEN" "$RESET"

# Compose v2 plugin?
docker compose version >/dev/null 2>&1 \
    || { printf '%s✗ Docker Compose v2 plugin not found (need: docker compose, not docker-compose)%s\n' \
             "$RED" "$RESET"; exit 1; }
_cv="$(docker compose version --short 2>/dev/null || echo "unknown")"
printf '%s✓ Docker Compose v2 present (%s)%s\n' "$GREEN" "$_cv" "$RESET"
