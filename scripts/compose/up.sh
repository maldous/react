#!/usr/bin/env bash
set -euo pipefail
# Usage: up.sh <ENV> <PROFILE> [extra docker-compose args...]
# Starts the given compose profile for ENV with retry on failure.
# PROFILE values: default | identity | observability |
#                 cloud | external-sentry | external-sonar |
#                 external-mocks | external-web | web

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
  external-sonar)
    # Shared SonarQube instance, dedicated postgres. Lives in react-sonar project
    # so it is immune to per-env compose-down-reset.
    SERVICES="sonar-postgres sonarqube"
    PROFILE_FLAG="--profile external-sonar"
    TIMEOUT=420
    COMPOSE_CMD="docker/compose-wrapper.sh sonar"
    ;;
  external-sentry)
    # List every sentry-* service explicitly so docker compose only starts those.
    # Without explicit names, --profile external-sentry also starts all no-profile
    # default services (postgres, redis, clickhouse...) causing port conflicts.
    SERVICES="sentry-postgres sentry-redis sentry-clickhouse sentry-kafka sentry-memcached sentry-snuba-migrate sentry-migrate sentry-kafka-init sentry-relay sentry-snuba-api sentry-snuba-errors sentry-snuba-replacer sentry-web sentry-events-consumer sentry-post-process-forwarder sentry-taskbroker sentry-taskworker sentry-taskscheduler sentry-cleanup"
    PROFILE_FLAG="--profile external-sentry"
    # Kafka KRaft init + Snuba CH migrations + Sentry postgres migrations chain
    # can take 15-20 min on cold start with no cached images.
    TIMEOUT=1200
    # Sentry lives in react-sentry project — immune to per-env compose-down-reset.
    COMPOSE_CMD="docker/compose-wrapper.sh sentry"
    ;;
  external-web)
    SERVICES="external-caddy"
    PROFILE_FLAG="--profile external-web"
    TIMEOUT=60
    # external-caddy always lives in the react-dev project (network_mode: host,
    # binds port 80) and routes aldous.info → localhost:83 and
    # staging.aldous.info → localhost:82 for Cloudflare origin requests.
    COMPOSE_CMD="docker/compose-wrapper.sh dev"
    ;;
  external-mocks)
    SERVICES="wiremock"
    PROFILE_FLAG="--profile external-mocks"
    TIMEOUT=60
    ;;
  identity-mocks)
    # mock-oidc upstream IdP fixture (ADR-ACT-0157). Built from services/mock-oidc.
    SERVICES="mock-oidc"
    PROFILE_FLAG="--profile identity-mocks"
    TIMEOUT=180
    EXTRA_FLAGS="--build"
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
