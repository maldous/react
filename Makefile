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

## all-promote — run the full promote ladder
## Sentry starts first (own project, survives env resets). external-caddy restarts after
## destructive stages (dev+test kill react-dev). staging/prod E2E need both live.
all-promote:
	docker network create sonar-bridge 2>/dev/null || true
	$(MAKE) sentry-up
	$(MAKE) stage-dev
	$(MAKE) stage-test
	$(MAKE) external-caddy-up
	$(MAKE) stage-staging
	$(MAKE) stage-prod
