.PHONY: env-validate-all env-drift-check

## env-validate-all — Validate all four .env.* files for required keys and values
env-validate-all:
	$(call STEP,env-validate-all)
	node scripts/preflight/check-env-files.mjs --all
	$(call OK,all env files valid)

## env-drift-check — Check env files against stage policy constraints (fixture auth, cookie security, log level)
env-drift-check:
	$(call STEP,env-drift-check)
	node scripts/preflight/check-env-drift.mjs
	$(call OK,no env drift detected)
