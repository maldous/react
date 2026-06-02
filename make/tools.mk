.PHONY: install format lint typecheck fix

## install — Install all npm dependencies (root + governance tools)
install:
	$(call STEP,install)
	npm ci
	@cd tools/architecture/validate-package-metadata && npm ci --silent
	@cd tools/architecture/validate-source-imports   && npm ci --silent
	@cd tools/architecture/validate-lifecycle-evidence && npm ci --silent
	$(call OK,dependencies installed)

## format — Write Prettier formatting then verify
format:
	$(call STEP,format)
	npm run format:write
	npm run format:check
	$(call OK,formatting clean)

## lint — Markdown lint + ESLint flat config
lint:
	$(call STEP,lint)
	npm run lint:md
	npm run lint
	$(call OK,lint clean)

## typecheck — TypeScript strict (app + all platform packages)
typecheck:
	$(call STEP,typecheck)
	npm run tsc:check
	$(call OK,TypeScript clean)

## fix — Auto-fix all Prettier formatting issues
fix:
	$(call STEP,fix \(format:write\))
	npm run format:write
	$(call OK,formatting applied)
