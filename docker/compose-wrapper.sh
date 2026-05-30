#!/usr/bin/env bash
# docker/compose-wrapper.sh
#
# Wrapper around docker compose that sources the per-environment .env file
# BEFORE invoking docker compose, so its variables are available for
# compose.yaml interpolation (port numbers, etc.).
#
# Docker Compose v5 uses --env-file only for container runtime environment
# variables, NOT for compose.yaml '${VAR}' interpolation. Shell environment
# variables are required for interpolation. This wrapper ensures that.
#
# Usage:
#   docker/compose-wrapper.sh <env> [docker compose args...]
#
# Example (called from Makefile):
#   docker/compose-wrapper.sh test up -d postgres
#
# Equivalent to:
#   source .env.test && docker compose --project-name test --env-file .env.test up -d postgres

set -euo pipefail

ENV="${1:?Usage: compose-wrapper.sh <env> [args...]}"
shift

ENV_FILE=".env.${ENV}"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Environment file not found: $ENV_FILE" >&2
    exit 1
fi

# Export all vars from the env file so docker compose can use them for interpolation
set -a
source "$ENV_FILE"
set +a

# Run docker compose with --project-name for container isolation and --env-file for
# container runtime env vars. The shell-exported vars above handle compose.yaml
# interpolation; --env-file handles container-level env.
exec docker compose \
    --project-name "$ENV" \
    --env-file "$ENV_FILE" \
    "$@"
