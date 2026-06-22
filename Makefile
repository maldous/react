# ── maldous/react Platform Makefile ─────────────────────────────────────────
#
# Usage:
#   make all           Full confidence ladder — each stage starts/refreshes its own environment
#   make env-up-all    Pre-start all environments (optional; promote starts them anyway)
#   make promote       Run the confidence ladder — dev → test → staging → prod
#   make env-status    Show container health for all environments
#   make env-down-all  Stop all environments when done
#   make check         Fast local check (no sonar, no compose smoke tests)
#   make help          Show all available targets
#
# ENV selector: make <target> ENV=dev|test|staging|prod  (default: dev)

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := all

# Load a root .env FILE if present (local dev convenience). Guarded with a
# regular-file test so the .env/ DIRECTORY of generated runtime artifacts
# (ADR-0072) is never mistaken for an includable file.
ENV_DOTFILE := $(shell test -f .env && echo .env)
-include $(ENV_DOTFILE)
export

include make/core.mk
include make/tools.mk
include make/env.mk
include make/clean.mk
include make/quality.mk
include make/compose.mk
include make/test.mk
include make/e2e.mk
include make/stages.mk
include make/evidence.mk
include make/help.mk

# ── Confidence ladder ────────────────────────────────────────────────────────
# Each stage starts or refreshes its own environment via run-stage.sh and
# stage-policy.yaml. Environments remain running after completion (teardownDefault: false).
# Use `make env-down-all` to stop everything when done.
#
# Staging and prod E2E tests run against the real external domains (APP_BASE_URL
# in each env file: http://staging.aldous.info and https://aldous.info). If the
# domains are unreachable, make all fails — this is intentional. The confidence
# ladder must confirm the entire stack, not just local containers.
.PHONY: all all-promote _all-promote-internal v2-foundation-assurance
## all — Full confidence ladder: clean-all → preflight → quality → v2-foundation-assurance → env-validate-all → env-drift-check → _all-promote-internal → evidence → env-status
## clean-all tears down dev and test (ephemeral). Staging and prod are preserved or started.
## Uses _all-promote-internal (the stage runs) then `evidence` ONCE — never via all-promote,
## so the ladder runs and evidence is verified exactly once.
all: clean-all \
     preflight \
     quality \
     v2-foundation-assurance \
     env-validate-all \
     env-drift-check \
     _all-promote-internal \
     evidence \
     env-status

## v2-foundation-assurance — Regenerate and verify V2 formal + USF semantic/runtime assurance
v2-foundation-assurance:
	$(call STEP,v2 foundation assurance)
	npm run v2:formal-assurance
	npm run v2:usf-assurance
	npm run v2:adversarial-usf-audit
	npx prettier --write docs/v2-foundation/formal-model/*.json docs/v2-foundation/mathematical-assurance-attestation.md docs/v2-foundation/usf-graph/*.json docs/v2-foundation/usf-audit/*.json docs/v2-foundation/usf-audit/*.md docs/v2-foundation/universal-service-foundation-assurance.md
	npm run v2:readiness -- --strict
	npm run v2:readiness -- --json
	npm test -- tools/v2-readiness
	$(call OK,V2 foundation assurance complete)

## _all-promote-internal — run the stage ladder (no verification). Internal: the orchestrator
## sets LADDER_CONTINUE_ON_DEGRADED=1 — the EXPLICIT continuation mode — so a DEGRADED stage
## does not halt the run and every stage's evidence is collected; a FAILED stage still halts
## immediately (run-stage exit 1). A DIRECT `make stage-<stage>` (no flag) returns exit 2 on
## DEGRADED. Sentry starts first (own project); external-caddy restarts after destructive stages.
_all-promote-internal:
	docker network create sonar-bridge 2>/dev/null || true
	$(MAKE) sentry-up
	LADDER_CONTINUE_ON_DEGRADED=1 $(MAKE) stage-dev
	LADDER_CONTINUE_ON_DEGRADED=1 $(MAKE) stage-test
	$(MAKE) external-caddy-up
	LADDER_CONTINUE_ON_DEGRADED=1 $(MAKE) stage-staging
	LADDER_CONTINUE_ON_DEGRADED=1 $(MAKE) stage-prod

## all-promote — run the full promote ladder AND verify it. A user invoking `make all-promote`
## directly gets the SAME honest result as `make all`: the stage ladder followed by `evidence`
## (verify-ladder), which FAILS on any non-FULL/degraded/stale stage. (ADR-ACT-0285 closure —
## direct invocation no longer reports success when a stage DEGRADED.)
all-promote: _all-promote-internal evidence

# ── Authoritative full-confidence gate ───────────────────────────────────────
# `make all` IS the authoritative full-confidence command: its test stage runs
# the Sonar absolute-zero quality gate (scripts/stages/run-stage.sh §9 — `make
# sonar`, test-stage only, the gating stage before staging/prod promote). So a
# green `make all` already proves Sonar passed; Sonar runs EXACTLY ONCE in the
# ladder. `release-confidence` is a discoverable alias for that authoritative run
# — it deliberately does NOT append a second `make sonar` (that would re-scan).
# The fast `make check` never runs Sonar (ADR-ACT-0290 / ADR-ACT-0291).
.PHONY: release-confidence
## release-confidence — Authoritative full-confidence run (alias for `make all`, which runs the Sonar gate at the test stage)
release-confidence:
	$(MAKE) all
	$(call OK,release-confidence complete — full ladder incl. Sonar absolute-zero gate (authoritative))
