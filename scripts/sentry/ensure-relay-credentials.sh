#!/usr/bin/env bash
set -euo pipefail
# Usage: ensure-relay-credentials.sh
#
# Self-hosted Sentry Relay runs in MANAGED mode (docker/sentry/relay.yml), which
# REQUIRES a credentials keypair in /work/.relay/credentials.json before it will
# start — otherwise it crash-loops with "relay has no credentials". The relay image
# is distroless (no shell), so we generate the credentials host-side, idempotently,
# into the persistent sentry-relay-data volume and fix ownership for the relay user
# (uid 65532). Must run BEFORE `compose up sentry` so relay comes up healthy on a
# fresh clone (ADR-0073 / ADR-ACT-0285 Phase 5.5).

RELAY_IMAGE="ghcr.io/getsentry/relay:26.5.2"
RELAY_UID="65532"
PROJECT="react-shared"
VOL="${PROJECT}_sentry-relay-data"

GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# Ensure the named volume exists (compose would create it on first mount; we create
# it up front so the generate step can target it).
docker volume create "$VOL" >/dev/null

# Idempotent: only generate when no credentials are present (bash does the conditional
# the distroless relay image cannot). Re-runs are a no-op so a persistent relay keeps
# its identity (no churn of stale upstream registrations).
if docker run --rm -v "$VOL":/r busybox test -f /r/credentials.json 2>/dev/null; then
  printf '%s✓ relay credentials already present%s\n' "$GREEN" "$RESET"
  exit 0
fi

printf '%s▶ generating Sentry Relay managed-mode credentials…%s\n' "$YELLOW" "$RESET"
docker run --rm --user 0:0 -v "$VOL":/work/.relay "$RELAY_IMAGE" credentials generate >/dev/null 2>&1
# credentials.json is written 0600 root:root; relay runs as 65532 and only needs to
# READ it — chown so the relay user can.
docker run --rm --user 0:0 -v "$VOL":/work/.relay busybox \
  chown -R "${RELAY_UID}:${RELAY_UID}" /work/.relay >/dev/null
printf '%s✓ relay credentials generated + owned by uid %s%s\n' "$GREEN" "$RELAY_UID" "$RESET"
