#!/usr/bin/env bash
set -euo pipefail
# Usage: assert-clean.sh <ENV>
# Verifies all containers are stopped and ports are free for ENV.

ENV="${1:?ENV argument required}"
RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

# Wait for ENV project containers to be gone (project name: react-<env>)
timeout 60 bash -c \
    "while docker ps -q --filter 'label=com.docker.compose.project=react-${ENV}' 2>/dev/null | grep -q .; do sleep 1; done" \
    || { printf '%s✗ containers still running for project react-%s after down%s\n' "$RED" "$ENV" "$RESET"
         docker ps --filter "label=com.docker.compose.project=react-${ENV}"
         exit 1; }

# Wait for Tilt default project containers to be gone (warn only)
timeout 60 bash -c \
    "while docker ps -q --filter 'label=com.docker.compose.project=react' 2>/dev/null | grep -q .; do sleep 1; done" \
    || true

# Verify ports free (spare JVM ports)
_jvm_ports="$(grep -oP '(?:KEYCLOAK|SONAR)_PORT=\K\d+' ".env.${ENV}" 2>/dev/null \
    | tr '\n' '|' | sed 's/|$//')"

for port in 5173 10350 $(grep -oP '_PORT=\K\d+' ".env.${ENV}" 2>/dev/null \
    | grep -vwE "${_jvm_ports:-__none__}"); do
    timeout 15 bash -c \
        "while ss -tlnp 'sport = :${port}' 2>/dev/null | grep -q LISTEN; do sleep 1; done" \
        || { printf '%s✗ port %s still in use%s\n' "$RED" "$port" "$RESET"
             ss -tlnp "sport = :${port}"
             exit 1; }
done

printf '%s✓ assert-clean: all ports free and containers stopped%s\n' "$GREEN" "$RESET"
