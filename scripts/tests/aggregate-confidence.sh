#!/usr/bin/env bash
# ADR-ACT-0285 — pure helpers for HONEST stage-confidence aggregation.
#
# Sourced by scripts/tests/run-env-tests.sh and unit-tested in isolation
# (scripts/tests/tests/aggregate-confidence.test.mjs). Kept side-effect-free so a
# test can source it without running a stage.
#
# Exit/result contract (shared with tools/e2e/result-contract.mjs):
#   0 = FULL/PASSED   1 = FAILED   2 = DEGRADED
#
# Only "contract-aware" groups (the node observability tools + the auth-e2e gate)
# may signal DEGRADED via exit 2. Every other group is pass/fail: any non-zero exit
# — including make's 2-on-target-failure — is a FAILURE, never a degrade.

CONTRACT_GROUPS=" e2e-observability-correlation e2e-failure-rootcause e2e-sentry-assertion auth-e2e "

# is_contract_group <group> → return 0 if the group speaks the 0/1/2 contract.
is_contract_group() {
  case "$CONTRACT_GROUPS" in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# classify_group_rc <group> <rc> → prints OK | DEGRADED | FAIL
#   contract-aware group: 0→OK, 2→DEGRADED, anything else→FAIL
#   pass/fail group:      0→OK, non-zero→FAIL
classify_group_rc() {
  local group="$1" rc="$2"
  if is_contract_group "$group"; then
    case "$rc" in
      0) printf 'OK\n' ;;
      2) printf 'DEGRADED\n' ;;
      *) printf 'FAIL\n' ;;
    esac
  else
    if [ "$rc" -eq 0 ]; then printf 'OK\n'; else printf 'FAIL\n'; fi
  fi
}
