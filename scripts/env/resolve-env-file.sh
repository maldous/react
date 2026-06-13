#!/usr/bin/env bash
# scripts/env/resolve-env-file.sh <stage>
#
# Echoes the absolute path of the runtime env file to consume for <stage>,
# under the ADR-0072 model where config/environments/<stage>.json is the
# source of truth and .env/<stage>.env is the generated runtime artifact.
#
# Resolution order:
#   1. .env/<stage>.env                 (generated artifact — fast path)
#   2. generate it from the manifest    (config/environments/<stage>.json)
#   3. .env.<stage>                      (legacy hand-maintained file — transition)
#
# Hand-maintained .env.<stage> files are NO LONGER required: if the manifest is
# present this script always produces .env/<stage>.env. The legacy branch only
# keeps a pre-migration checkout working.
set -euo pipefail

STAGE="${1:?Usage: resolve-env-file.sh <stage>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

GEN="${ROOT}/.env/${STAGE}.env"
LEGACY="${ROOT}/.env.${STAGE}"
MANIFEST="${ROOT}/config/environments/${STAGE}.json"

if [ -f "$GEN" ]; then
    echo "$GEN"
    exit 0
fi

# Materialise the artifact from its manifest. The generator knows both per-stage
# targets (config/environments/<stage>.json) and shared services sonar/sentry
# (config/environments/shared.json); it exits non-zero for an unknown target.
# Diagnostics to stderr so the stdout contract (a single path) stays clean.
if node "${ROOT}/scripts/env/generate-runtime-env.mjs" "$STAGE" >&2 2>/dev/null && [ -f "$GEN" ]; then
    echo "$GEN"
    exit 0
fi

if [ -f "$LEGACY" ]; then
    echo "$LEGACY"
    exit 0
fi

echo "ERROR: cannot generate ${GEN} (no manifest for '${STAGE}') and no legacy ${LEGACY}" >&2
echo "       run: make env-generate-runtime ENV=${STAGE}" >&2
exit 1
