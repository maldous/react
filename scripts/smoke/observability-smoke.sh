#!/usr/bin/env bash
set -euo pipefail
# Usage: observability-smoke.sh <ENV>
# Checks Loki and Grafana health for the given environment (warn-only).

ENV="${1:?ENV required}"
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

_loki_port="$(grep -oP 'LOKI_PORT=\K\d+' ".env.${ENV}" 2>/dev/null | head -1 || true)"
_loki_port="${_loki_port:-3100}"
_grafana_port="$(grep -oP 'GRAFANA_PORT=\K\d+' ".env.${ENV}" 2>/dev/null | head -1 || true)"
_grafana_port="${_grafana_port:-3200}"

if curl -fsS --max-time 5 "http://localhost:${_loki_port}/ready" >/dev/null 2>&1; then
    printf '%s✓ Loki ready at :%s%s\n' "$GREEN" "$_loki_port" "$RESET"
else
    printf '%s⚠ Loki not reachable at :%s (observability profile may not be running)%s\n' \
        "$YELLOW" "$_loki_port" "$RESET"
fi

if curl -fsS --max-time 5 "http://localhost:${_grafana_port}/api/health" >/dev/null 2>&1; then
    printf '%s✓ Grafana ready at :%s%s\n' "$GREEN" "$_grafana_port" "$RESET"
else
    printf '%s⚠ Grafana not reachable at :%s%s\n' "$YELLOW" "$_grafana_port" "$RESET"
fi

printf '%s✓ observability smoke complete (warn-only)%s\n' "$GREEN" "$RESET"
