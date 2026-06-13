#!/usr/bin/env bash
set -euo pipefail
# Usage: clean-env.sh <ENV>
# Stops services for ENV, kills stale port-holding processes, removes artefacts.

ENV="${1:?ENV argument required}"
BOLD=$(tput bold 2>/dev/null || true)
BLUE=$(tput setaf 4 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RED=$(tput setaf 1 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

COMPOSE_CMD="docker/compose-wrapper.sh ${ENV}"

printf '\n%s▶ clean: stopping %s services ◀%s\n' "${BOLD}${BLUE}" "$ENV" "$RESET"

# Stop all profiles for this env
$COMPOSE_CMD --profile web --profile cloud-mocks \
    --profile external-mocks \
    down --timeout 30 2>/dev/null || true
$COMPOSE_CMD down --timeout 30 2>/dev/null || true

# Force-remove containers for this env's project, but never external-caddy regardless
# of which project it ended up in. external-caddy is the Cloudflare-facing reverse proxy
# for aldous.info / staging.aldous.info — killing it takes down production traffic.
# With project_name='react-dev' in the Tiltfile, external-caddy lands in react-dev when
# Tilt is running, so the exception must be applied to react-${ENV} as well as react.
docker ps -q \
    --filter "label=com.docker.compose.project=react-${ENV}" \
    --filter "label=com.docker.compose.service!=external-caddy" \
    | xargs -r docker rm -f 2>/dev/null || true

# Also clean stale containers from the legacy bare "react" project name (pre-rename).
docker ps -q \
    --filter "label=com.docker.compose.project=react" \
    --filter "label=com.docker.compose.service!=external-caddy" \
    | xargs -r docker rm -f 2>/dev/null || true
docker volume ls -q --filter "label=com.docker.compose.project=react" \
    | xargs -r docker volume rm 2>/dev/null || true

# Kill stale port holders (spare JVM services: Keycloak)
_ENVF="$(bash "$(dirname "$0")/../env/resolve-env-file.sh" "$ENV" 2>/dev/null || echo ".env.${ENV}")"
_jvm_ports="$(grep -oP 'KEYCLOAK_PORT=\K\d+' "$_ENVF" 2>/dev/null \
    | tr '\n' '|' | sed 's/|$//')"

_all_ports="5173 10350 $(grep -oP '_PORT=\K\d+' "$_ENVF" 2>/dev/null \
    | grep -vwE "${_jvm_ports:-__none__}")"

for port in $_all_ports; do
    _cids="$(docker ps -q --filter "publish=${port}" 2>/dev/null)"
    if [ -n "$_cids" ]; then
        echo "$_cids" | xargs docker rm -f 2>/dev/null || true
        timeout 10 bash -c \
            "while docker ps -q --filter 'publish=${port}' 2>/dev/null | grep -q .; do sleep 1; done" \
            || printf '%s✗ container on port %s still running%s\n' "$RED" "$port" "$RESET"
    fi
done

# Kill processes holding ports via fuser
# shellcheck disable=SC2086
sudo fuser -k \
    4173/tcp 5173/tcp 10350/tcp \
    $(printf '%s/tcp ' $_all_ports) \
    2>/dev/null || true

# Remove build artefacts
rm -rf coverage/ reports/ .scannerwork/ playwright-report/ e2e-results/ .tilt.pid

printf '%s✓ clean: services stopped and artefacts removed for %s%s\n' "$GREEN" "$ENV" "$RESET"
