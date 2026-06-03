.PHONY: preflight stage-dev stage-test stage-staging stage-prod

## preflight — Check required binaries, Docker, env files, ports, and clean state
preflight:
	$(call STEP,preflight)
	bash scripts/preflight/check-binaries.sh
	bash scripts/preflight/check-docker.sh
	node scripts/preflight/check-env-files.mjs
	node scripts/preflight/check-port-conflicts.mjs
	node scripts/preflight/check-hosts.mjs
	node scripts/preflight/check-clean-state.mjs
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
