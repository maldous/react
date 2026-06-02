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

## stage-dev — Dev stage: Tilt executor, destructive data, minimal-smoke + unit + internal E2E
stage-dev:
	$(call STEP,stage:dev)
	bash scripts/stages/run-stage.sh dev

## stage-test — Test stage: Compose executor, destructive data, unit/contract/port/interface + E2E smoke
stage-test:
	$(call STEP,stage:test)
	bash scripts/stages/run-stage.sh test

## stage-staging — Staging stage: Compose HA, preserve data, integration + external smoke (no teardown)
stage-staging:
	$(call STEP,stage:staging)
	bash scripts/stages/run-stage.sh staging

## stage-prod — Production stage: Compose HA, preserve data, all production-safe tests + production E2E (no teardown)
stage-prod:
	$(call STEP,stage:prod)
	bash scripts/stages/run-stage.sh prod
