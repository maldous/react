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
#   source .env.test && docker compose --project-name react-test --env-file .env.test up -d postgres
#
# Project naming convention: react-<env> (react-dev, react-test, react-staging, react-prod).
# All four environments can run concurrently with fully isolated container/volume/network namespaces.
#
# Cross-environment SHARED services (Caddy, Sentry, mock-oidc) live in the single
# react-shared project. They source a per-service .env file for interpolation but
# share one project namespace. Set PROJECT to override the derived project name:
#   PROJECT=react-shared docker/compose-wrapper.sh sentry --profile external-sentry up -d

set -euo pipefail

ENV="${1:?Usage: compose-wrapper.sh <env> [args...]}"
shift

# ADR-0072: resolve the runtime env file via the shared resolver — the generated
# artifact .env/<env>.env (from config/environments/<env>.json) is preferred; a
# legacy hand-maintained .env.<env> is only used if no manifest exists. The
# resolver materialises the artifact from the manifest on demand and exits
# non-zero (propagated by set -e) if neither source exists.
ENV_FILE="$("$(dirname "${BASH_SOURCE[0]}")/../scripts/env/resolve-env-file.sh" "$ENV")"
PROJECT_NAME="${PROJECT:-react-$ENV}"

# Export all vars from the env file so docker compose can use them for interpolation
set -a
source "$ENV_FILE"
set +a

# Run docker compose with --project-name for container isolation and --env-file for
# container runtime env vars. The shell-exported vars above handle compose.yaml
# interpolation; --env-file handles container-level env.
exec docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    "$@"
