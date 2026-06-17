#!/usr/bin/env bash
# ADR-ACT-0285 (closure) — pure stage exit-code decision. Sourced by
# scripts/stages/run-stage.sh and unit-tested in scripts/tests/tests/stage-exit.test.mjs.
# Kept side-effect-free so a test can source it without running a stage.
#
# Honest contract (no process-result lie):
#   FAILED   (stage_result != 0)                  → 1   (a real failure ALWAYS halts)
#   DEGRADED (degraded=1) + continue!=1           → 2   (direct stage: degraded never passes)
#   DEGRADED (degraded=1) + continue=1            → 0   (orchestrator continuation ONLY)
#   FULL                                          → 0

# stage_exit_code <stage_result> <degraded> <continue_flag> → prints 0|1|2
stage_exit_code() {
  local result="$1" degraded="$2" cont="$3"
  if [ "$result" != "0" ]; then
    printf '1\n'
    return
  fi
  if [ "$degraded" = "1" ]; then
    if [ "$cont" = "1" ]; then printf '0\n'; else printf '2\n'; fi
    return
  fi
  printf '0\n'
}
