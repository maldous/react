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

# Load .env if present (provides SONAR_TOKEN, SONAR_HOST_URL, etc.)
-include .env
export

include make/core.mk
include make/tools.mk
include make/env.mk
include make/clean.mk
include make/quality.mk
include make/compose.mk
include make/tilt.mk
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
.PHONY: all all-promote
## all — Full confidence ladder: clean-all → preflight → quality → env-validate-all → env-drift-check → all-promote → evidence → env-status
## clean-all tears down dev and test (ephemeral). Staging and prod are preserved or started.
all: clean-all \
     preflight \
     quality \
     env-validate-all \
     env-drift-check \
     all-promote \
     evidence \
     env-status

## all-promote — run the full promote ladder with external-caddy (re)started after destructive stages
## stage-dev and stage-test run compose-down-reset which tears down react-dev including
## external-caddy. Restart it after destructive stages so staging/prod E2E have a live origin.
all-promote:
	$(MAKE) stage-dev
	$(MAKE) stage-test
	$(MAKE) external-caddy-up
	$(MAKE) stage-staging
	$(MAKE) stage-prod
