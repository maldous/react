.PHONY: env-validate-all env-drift-check env-generate-runtime env-generate-runtime-all \
        env-bootstrap env-init env-reconcile env-seed-secrets env-seed-providers \
        env-seed-config env-seed-admin env-print-admin env-rotate-secret \
        env-provider-up env-provider-reconcile env-bootstrap-seed

# Loader for app-backed seed scripts (Postgres/usecases), mirrors the proof scripts.
ENV_SEED = node --loader "$(shell pwd)/apps/platform-api/loader.mjs" apps/platform-api/scripts/seed-environment.ts

# ── ADR-0072: Makefile-driven environment substrate ──────────────────────────
# The tracked, non-secret manifests config/environments/<stage>.json are the
# source of truth. .env/<stage>.env are generated runtime ARTIFACTS (gitignored,
# reproducible, non-authoritative). No hand-maintained .env.* file is required.
# The manifest validator subsumes the legacy check-env-files + check-env-drift.

## env-generate-runtime — Generate the runtime env artifact (.env/$(ENV).env) from the manifest
env-generate-runtime:
	$(call STEP,env-generate-runtime ($(ENV)))
	node scripts/env/generate-runtime-env.mjs $(ENV)
	$(call OK,.env/$(ENV).env generated from config/environments/$(ENV).json)

## env-generate-runtime-all — Generate runtime env artifacts for every stage
env-generate-runtime-all:
	$(call STEP,env-generate-runtime-all)
	node scripts/env/generate-runtime-env.mjs --all
	$(call OK,all runtime env artifacts generated under .env/)

## env-validate-all — Validate all environment manifests + generated runtime env
## Replaces check-env-files.mjs --all. Generates artifacts first so freshness is checked.
env-validate-all: env-generate-runtime-all
	$(call STEP,env-validate-all)
	node scripts/env/validate-manifests.mjs --all
	$(call OK,all environment manifests valid)

## env-drift-check — Re-assert stage-policy conformance against the manifests
## Replaces check-env-drift.mjs. Policy/drift checks live in the manifest validator.
env-drift-check:
	$(call STEP,env-drift-check)
	node scripts/env/validate-manifests.mjs --all
	$(call OK,no manifest/policy drift detected)

# ── Bootstrap + operations (ADR-0072) ────────────────────────────────────────
# All seed steps degrade honestly: they SKIP (never fail/fake) when Postgres or
# OpenBao is unreachable, so the confidence ladder is never weakened by a missing
# optional substrate. Secrets are seeded into OpenBao when reachable; otherwise the
# generated artifact holds reproducible local-bootstrap material (gitignored).

## env-init — Generate runtime env + project the manifest into the environment registry
env-init: env-generate-runtime
	$(call STEP,env-init ($(ENV)))
	$(ENV_SEED) sync $(ENV)
	$(call OK,$(ENV) initialised (runtime env generated + registry synced))

## env-seed-secrets — Seed OpenBao with the environment's secret keys (honest skip if down)
env-seed-secrets: env-generate-runtime
	$(call STEP,env-seed-secrets ($(ENV)))
	node scripts/env/bootstrap.mjs seed-secrets $(ENV)

## env-seed-providers — Seed provider_configs from the manifest's seededProviderDefaults
env-seed-providers:
	$(call STEP,env-seed-providers ($(ENV)))
	$(ENV_SEED) providers $(ENV)

## env-seed-config — Seed environment-level managed config (the registry projection; narrow first slice)
env-seed-config:
	$(call STEP,env-seed-config ($(ENV)))
	$(ENV_SEED) sync $(ENV)
	$(call OK,$(ENV) environment-level managed config seeded (registry projection))

## env-seed-admin — Generate the per-environment global system administrator handoff
env-seed-admin: env-generate-runtime
	$(call STEP,env-seed-admin ($(ENV)))
	node scripts/env/bootstrap.mjs seed-admin $(ENV)

## env-print-admin — Re-print the per-environment admin login handoff (authorised local command)
env-print-admin:
	node scripts/env/bootstrap.mjs print-admin $(ENV)

## env-rotate-secret — Rotate one managed secret (ENV=<stage> KEY=<KEY>) + regenerate runtime env
env-rotate-secret:
	$(call STEP,env-rotate-secret ($(ENV) KEY=$(KEY)))
	node scripts/env/bootstrap.mjs rotate-secret $(ENV) $(KEY)
	$(MAKE) env-generate-runtime ENV=$(ENV)

## env-provider-up — Start one allowed provider profile (ENV=<stage> PROVIDER=<profile>)
env-provider-up:
	$(call STEP,env-provider-up ($(ENV) PROVIDER=$(PROVIDER)))
	bash scripts/compose/up.sh $(ENV) $(PROVIDER)

## env-provider-reconcile — Re-probe a provider's readiness + mark the environment reconciled
env-provider-reconcile:
	$(call STEP,env-provider-reconcile ($(ENV) PROVIDER=$(PROVIDER)))
	-bash scripts/compose/wait.sh $(ENV) 60
	$(ENV_SEED) reconcile $(ENV)

## env-reconcile — Re-sync the manifest + mark the environment reconciled
env-reconcile: env-generate-runtime
	$(call STEP,env-reconcile ($(ENV)))
	$(ENV_SEED) reconcile $(ENV)

## env-bootstrap-seed — Idempotent post-migration seed: registry + providers + config + admin
## Used by the stage runner after migrations. Each step degrades honestly (skip if no backend).
env-bootstrap-seed:
	$(call STEP,env-bootstrap-seed ($(ENV)))
	-$(ENV_SEED) all $(ENV)
	-node scripts/env/bootstrap.mjs seed-secrets $(ENV)
	-node scripts/env/bootstrap.mjs seed-admin $(ENV)
	$(call OK,$(ENV) bootstrap seed complete (registry + providers + secrets + admin))

## env-bootstrap — Full per-environment bootstrap: runtime env → migrate → init → seed → admin
## Assumes the environment's services are up (via stage-$(ENV)); seed steps skip honestly otherwise.
env-bootstrap: env-generate-runtime
	$(call STEP,env-bootstrap ($(ENV)))
	-$(MAKE) db-migrate ENV=$(ENV)
	$(MAKE) env-init ENV=$(ENV)
	$(MAKE) env-seed-secrets ENV=$(ENV)
	$(MAKE) env-seed-providers ENV=$(ENV)
	$(MAKE) env-seed-config ENV=$(ENV)
	$(MAKE) env-seed-admin ENV=$(ENV)
	$(call OK,$(ENV) bootstrapped — see the admin handoff above)
