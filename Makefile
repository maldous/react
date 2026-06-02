# ── maldous/react Platform Makefile ─────────────────────────────────────────
#
# Usage:
#   make all           Full confidence ladder: preflight → quality → 4 stages → evidence
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
.PHONY: all
## all — Complete promotion pipeline: preflight → quality → env-validate → 4 stages → evidence
all: preflight \
     quality \
     env-validate-all \
     env-drift-check \
     stage-dev \
     stage-test \
     stage-staging \
     stage-prod \
     evidence
