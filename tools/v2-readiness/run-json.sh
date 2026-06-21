#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# tools/v2-readiness/run-json.sh
#
# Thin wrapper that invokes the readiness CLI directly via `node`, NOT via
# `npm run`. The npm-runner writes lifecycle-script banners (e.g.
# `> react-platform@0.1.0 v2:readiness:json > node ...`) to stdout under some
# Node/npm versions, which corrupts the pure-JSON output that the v2 readiness
# gate is contractually required to produce for `--json`.
#
# By calling `node` directly we eliminate the npm banner and let the script
# emit a single JSON document on stdout. Status / progress stays on stderr
# so a redirected `1>report.json 2>progress.log` works as expected.
#
# Exit codes:
#   0  cutReady = true OR ok = true
#   1  consistency findings or completion blockers remain
#   2  context-load failure (mirrored from the node CLI)
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
LOG_FILE="${READINESS_LOG_FILE:-${REPO_ROOT}/docs/evidence/stages/v2-readiness-progress.log}"

# All non-JSON status chatter goes to stderr (file + fd2) so stdout stays pure JSON.
exec 3>>"${LOG_FILE}"

log() { printf '%s\n' "$@" >&3 >&2; }

log "running v2 readiness (json) at $(date -u +%FT%TZ) from ${REPO_ROOT}"

# Invoke node directly \u2014 skip the npm-run lifecycle script entirely.
node "${REPO_ROOT}/tools/v2-readiness/src/index.mjs" --strict --json
