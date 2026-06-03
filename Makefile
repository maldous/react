# ── maldous/react Platform Makefile ─────────────────────────────────────────
#
# Usage:
#   make all           Full confidence ladder — all environments remain running after completion
#   make env-up-all    Start all isolated environments (react-dev/test/staging/prod)
#   make promote       Run validation on all running environments (no teardown)
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

# ── Persistent confidence ladder ─────────────────────────────────────────────
# Environments remain running after `make all`. Each stage validates its
# isolated stack (react-dev / react-test / react-staging / react-prod) and
# writes evidence. Use `make env-down-all` to stop everything when done.
.PHONY: all
## all — Full confidence ladder: preflight → quality → env-up-all → promote → evidence → env-status
all: preflight \
     quality \
     env-validate-all \
     env-drift-check \
     env-up-all \
     promote \
     evidence \
     env-status
