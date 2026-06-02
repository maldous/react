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
	# ADR-0034: stage-dev runs e2e-internal via run-stage.sh policy
	$(call STEP,stage:dev)
	bash scripts/stages/run-stage.sh dev

## stage-test — Test stage: Compose executor, destructive data, unit/contract/port/interface + E2E smoke
stage-test:
	# ADR-0034: stage-test runs e2e-internal + run-stage-tests via run-stage.sh policy
	$(call STEP,stage:test)
	bash scripts/stages/run-stage.sh test

## stage-staging — Staging stage: Compose HA, preserve data, integration + external smoke (no teardown)
stage-staging:
	# ADR-0034: stage-staging runs e2e-external via run-stage.sh policy (no fixture sessions)
	$(call STEP,stage:staging)
	bash scripts/stages/run-stage.sh staging

## stage-prod — Production stage: Compose HA, preserve data, all production-safe tests + production E2E (no teardown)
stage-prod:
	# ADR-0034: stage-prod runs e2e-external + test:e2e:prod via run-stage.sh policy
	$(call STEP,stage:prod)
	bash scripts/stages/run-stage.sh prod
