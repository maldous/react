#!/usr/bin/env bash
set -euo pipefail
# Usage: down.sh <ENV> [--volumes]
# Stops compose services for ENV and waits for containers to be gone.

ENV="${1:?ENV required}"
VOLUMES_FLAG=""
[ "${2:-}" = "--volumes" ] && VOLUMES_FLAG="--volumes"

COMPOSE_CMD="docker/compose-wrapper.sh ${ENV}"
RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# shellcheck disable=SC2086
$COMPOSE_CMD down --timeout 30 $VOLUMES_FLAG

timeout 60 bash -c \
    "while docker ps -q --filter 'label=com.docker.compose.project=react-${ENV}' 2>/dev/null | grep -q .; do sleep 1; done" \
    || { printf '%s✗ containers still running for project react-%s%s\n' "$RED" "$ENV" "$RESET"
         docker ps --filter "label=com.docker.compose.project=react-${ENV}"
         exit 1; }

printf '%s✓ compose down complete for %s%s\n' "$GREEN" "$ENV" "$RESET"
