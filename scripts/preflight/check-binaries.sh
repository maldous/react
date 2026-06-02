#!/usr/bin/env bash
set -euo pipefail
# Verifies required binaries are available on PATH.
# Pass --no-tilt to skip Tilt check (for compose-executor stages).

SKIP_TILT=false
[[ "${1:-}" == "--no-tilt" ]] && SKIP_TILT=true

RED=$(tput setaf 1 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)

MISSING=()

check() {
    local bin="$1"
    local label="${2:-$1}"
    if command -v "$bin" >/dev/null 2>&1; then
        printf '%s✓ %s (%s)%s\n' "$GREEN" "$label" "$(command -v "$bin")" "$RESET"
    else
        printf '%s✗ %s not found%s\n' "$RED" "$label" "$RESET"
        MISSING+=("$label")
    fi
}

check node "node"
check npm  "npm"
check npx  "npx"
check docker "docker"
check git  "git"
check curl "curl"
check jq   "jq"

# ss preferred; lsof as fallback
if command -v ss >/dev/null 2>&1; then
    printf '%s✓ ss (socket stats)%s\n' "$GREEN" "$RESET"
elif command -v lsof >/dev/null 2>&1; then
    printf '%s✓ lsof (socket stats fallback)%s\n' "$GREEN" "$RESET"
else
    printf '%s✗ neither ss nor lsof found%s\n' "$RED" "$RESET"
    MISSING+=("ss/lsof")
fi

# Tilt (optional for compose-executor stages)
if [ "$SKIP_TILT" = false ]; then
    check tilt "tilt"
fi

# terraform or tofu (warn-only — not required for non-infra work)
if command -v terraform >/dev/null 2>&1 || command -v tofu >/dev/null 2>&1 || [ -f "infra/bin/tf" ]; then
    printf '%s✓ terraform/tofu (infra/bin/tf wrapper present)%s\n' "$GREEN" "$RESET"
else
    printf '%s⚠ terraform/tofu not found — infra-check and keycloak-provision will fail%s\n' \
        "$YELLOW" "$RESET"
fi

if [ ${#MISSING[@]} -gt 0 ]; then
    printf '\n%s✗ Missing required binaries: %s%s\n' \
        "$RED" "${MISSING[*]}" "$RESET"
    exit 1
fi

printf '%s✓ all required binaries present%s\n' "$GREEN" "$RESET"
