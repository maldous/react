#!/usr/bin/env bash
set -euo pipefail
# Usage: up.sh <ENV> <PROFILE> [extra docker-compose args...]
# Starts the given compose profile for ENV with retry on failure.
# PROFILE values: default | identity | quality | observability |
#                 cloud | sentry | external-mocks | web

ENV="${1:?ENV required}"
PROFILE="${2:?PROFILE required}"
shift 2

COMPOSE_CMD="docker/compose-wrapper.sh ${ENV}"
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

EXTRA_FLAGS=""

case "$PROFILE" in
  default)
    SERVICES="postgres redis clickhouse minio mailpit otel-collector"
    PROFILE_FLAG=""
    TIMEOUT=120
    ;;
  identity)
    SERVICES="keycloak"
    PROFILE_FLAG="--profile identity"
    TIMEOUT=360
    ;;
  quality)
    SERVICES="sonarqube"
    PROFILE_FLAG="--profile quality"
    TIMEOUT=420
    ;;
  observability)
    SERVICES="loki grafana alloy"
    PROFILE_FLAG="--profile observability"
    TIMEOUT=120
    ;;
  cloud)
    SERVICES="localstack"
    PROFILE_FLAG="--profile cloud-mocks"
    TIMEOUT=120
    ;;
  sentry)
    SERVICES=""
    PROFILE_FLAG="--profile sentry"
    TIMEOUT=900
    ;;
  external-mocks)
    SERVICES="wiremock"
    PROFILE_FLAG="--profile external-mocks"
    TIMEOUT=60
    ;;
  web)
    SERVICES=""
    PROFILE_FLAG="--profile web"
    TIMEOUT=420
    EXTRA_FLAGS="--build"
    ;;
  *)
    printf '%s✗ Unknown profile: %s%s\n' "$RED" "$PROFILE" "$RESET"
    exit 1
    ;;
esac

printf '%sStarting %s profile for %s...%s\n' "$GREEN" "$PROFILE" "$ENV" "$RESET"

# shellcheck disable=SC2086
if ! $COMPOSE_CMD $PROFILE_FLAG up -d $EXTRA_FLAGS --wait \
        --wait-timeout "$TIMEOUT" $SERVICES "$@"; then
    printf '%s⚠ %s profile failed for %s — retrying after down...%s\n' \
        "$YELLOW" "$PROFILE" "$ENV" "$RESET"
    # shellcheck disable=SC2086
    $COMPOSE_CMD $PROFILE_FLAG down --timeout 30 >/dev/null 2>&1 || true
    sleep 2
    # shellcheck disable=SC2086
    $COMPOSE_CMD $PROFILE_FLAG up -d $EXTRA_FLAGS --wait \
        --wait-timeout "$TIMEOUT" $SERVICES "$@"
fi

printf '%s✓ %s profile healthy for %s%s\n' "$GREEN" "$PROFILE" "$ENV" "$RESET"
