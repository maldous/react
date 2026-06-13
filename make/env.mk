.PHONY: env-validate-all env-drift-check env-generate-runtime env-generate-runtime-all

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
