.PHONY: preflight stage-dev stage-test stage-staging stage-prod \
        env-up-all env-down-all env-status promote

## preflight — Check required binaries, Docker, all env files, and port definitions
## All four env files (dev/test/staging/prod) are validated at preflight time.
## Note: clean-state is NOT checked here because all four environments are expected
## to be running persistently. Use `make env-down-all` + `make clean-all` if you
## need a completely fresh start.
preflight:
	$(call STEP,preflight)
	bash scripts/preflight/check-binaries.sh
	bash scripts/preflight/check-docker.sh
	node scripts/preflight/check-env-files.mjs --all
	node scripts/preflight/check-port-conflicts.mjs
	node scripts/preflight/check-hosts.mjs
	$(call OK,preflight passed)

## stage-dev — Dev stage: Tilt executor, destructive data, minimal-smoke + unit + e2e-internal
stage-dev:
	# ADR-0034: stage-dev runs minimal-smoke + unit + e2e-internal (via e2e-smoke)
	$(call STEP,stage:dev)
	bash scripts/stages/run-stage.sh dev

## stage-test — Test stage: Compose executor, destructive data, unit/contract/port/interface + E2E smoke
stage-test:
	# ADR-0034: stage-test runs e2e-internal + run-stage-tests via run-stage.sh policy
	$(call STEP,stage:test)
	bash scripts/stages/run-stage.sh test

## stage-staging — Staging stage: Compose HA, preserve data, integration + compose-smoke + external-smoke (no teardown, no tenants)
stage-staging:
	# ADR-0034: stage-staging runs integration + compose-smoke + external-smoke (no fixture sessions, no tenant tests)
	$(call STEP,stage:staging)
	bash scripts/stages/run-stage.sh staging

## stage-prod — Production stage: Compose HA, preserve data, all production-safe tests + external-smoke + auth-e2e + production E2E (no teardown)
stage-prod:
	# ADR-0034: stage-prod runs external-smoke + auth-e2e + test:e2e:prod — auth-e2e fails if localhost
	$(call STEP,stage:prod)
	bash scripts/stages/run-stage.sh prod

# ── Persistent environment lifecycle ─────────────────────────────────────────

## env-up-all — Start all four isolated environments and leave them running
## Project names: react-dev, react-test, react-staging, react-prod
env-up-all:
	$(call STEP,env-up-all: starting all environments)
	@printf '$(BOLD)▶ Starting react-dev (Tilt)...$(RESET)\n'
	$(MAKE) tilt-up
	@printf '$(BOLD)▶ Starting react-test (Compose)...$(RESET)\n'
	$(MAKE) test-up
	@printf '$(BOLD)▶ Starting react-staging (Compose)...$(RESET)\n'
	$(MAKE) staging-up
	@printf '$(BOLD)▶ Starting react-prod (Compose)...$(RESET)\n'
	$(MAKE) prod-up
	$(call OK,all environments running: react-dev / react-test / react-staging / react-prod)

## env-down-all — Stop all four environments
env-down-all:
	$(call STEP,env-down-all: stopping all environments)
	-$(MAKE) tilt-down
	-$(MAKE) compose-down ENV=dev
	-$(MAKE) compose-down ENV=test
	-$(MAKE) compose-down ENV=staging
	-$(MAKE) compose-down ENV=prod
	$(call OK,all environments stopped)

## env-status — Show container health for all four environments
env-status:
	$(call STEP,env-status)
	@printf '\n$(BOLD)── react-dev ────────────────────────────────────────$(RESET)\n'
	@docker/compose-wrapper.sh dev ps 2>/dev/null || printf '  (not running)\n'
	@printf '\n$(BOLD)── react-test ───────────────────────────────────────$(RESET)\n'
	@docker/compose-wrapper.sh test ps 2>/dev/null || printf '  (not running)\n'
	@printf '\n$(BOLD)── react-staging ────────────────────────────────────$(RESET)\n'
	@docker/compose-wrapper.sh staging ps 2>/dev/null || printf '  (not running)\n'
	@printf '\n$(BOLD)── react-prod ───────────────────────────────────────$(RESET)\n'
	@docker/compose-wrapper.sh prod ps 2>/dev/null || printf '  (not running)\n'
	@printf '\n'
	$(call OK,env-status complete)

## promote — Run the full confidence ladder without tearing down any environment
## Assumes environments are already running (env-up-all). Each stage validates
## its environment and leaves it running. Data is reset for destructive stages.
promote: stage-dev stage-test stage-staging stage-prod
	$(call OK,promotion complete — all environments validated and running)
