.PHONY: help infra-check keycloak-plan-dev readmes generate \
        pre-slice-gate local-substrate-check

## help — Show all documented targets
help:
	@printf '\n$(BOLD)maldous/react — platform Makefile$(RESET)\n\n'
	@grep -hE '^## ' $(MAKEFILE_LIST) \
		| sed 's/^## //' \
		| awk '{printf "  $(GREEN)%-28s$(RESET) %s\n", $$1, substr($$0, index($$0,$$2))}'
	@printf '\n$(BOLD)ENV selector:$(RESET) make <target> ENV=dev|test|staging|prod  (default: dev)\n\n'

## infra-check — Validate Terraform/OpenTofu syntax, format, init, and validate (no cloud credentials needed)
infra-check:
	$(call STEP,infra:check)
	@chmod +x infra/bin/tf
	@infra/bin/tf fmt -check -recursive infra/ \
		&& printf '$(GREEN)✓ terraform format clean$(RESET)\n' \
		|| { printf '$(YELLOW)⚠ run: infra/bin/tf fmt -recursive infra/$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev init -backend=false -input=false > /dev/null 2>&1 \
		&& printf '$(GREEN)✓ infra/env/dev init ok$(RESET)\n' \
		|| { printf '$(YELLOW)⚠ init failed — check provider availability (requires internet for first run)$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev validate -no-color \
		&& printf '$(GREEN)✓ infra/env/dev validate ok$(RESET)\n' \
		|| { printf '$(RED)✗ infra/env/dev validate failed$(RESET)\n'; exit 1; }
	$(call OK,infra check complete)

## keycloak-plan-dev — Plan Keycloak provisioning against dev Compose Keycloak
##   Requires: docker compose --profile identity up -d keycloak (port from KEYCLOAK_PORT in .env.$ENV)
##   Uses: infra/env/dev/dev.tfvars.example (placeholder secrets — safe to plan)
keycloak-plan-dev:
	$(call STEP,keycloak:plan:dev)
	@chmod +x infra/bin/tf
	@printf '$(BOLD)Requires: docker compose --profile identity up -d keycloak$(RESET)\n'
	@_kc_port="$$(grep -oP 'KEYCLOAK_PORT=\K\d+' .env.$(ENV) 2>/dev/null | head -1)"; _kc_port=$${_kc_port:-8090}; \
	curl -sf http://localhost:$${_kc_port}/kc/realms/master > /dev/null 2>&1 \
		|| { printf '$(RED)✗ Keycloak not reachable at http://localhost:%s/kc\n  Run: make compose-up-identity ENV=$(ENV)$(RESET)\n' "$$_kc_port"; exit 1; }; \
	printf '$(GREEN)✓ Keycloak reachable at http://localhost:%s/kc$(RESET)\n' "$$_kc_port"
	@infra/bin/tf -chdir=infra/env/dev init -backend=false -input=false > /dev/null 2>&1 \
		&& printf '$(GREEN)✓ init ok$(RESET)\n' \
		|| { printf '$(RED)✗ init failed$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev validate -no-color \
		&& printf '$(GREEN)✓ validate ok$(RESET)\n' \
		|| { printf '$(RED)✗ validate failed$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev plan \
		-var-file=dev.tfvars.example \
		-input=false \
		-no-color
	$(call OK,keycloak plan complete — review above before running apply)

## readmes — Regenerate all package READMEs from metadata
readmes:
	$(ORCHESTRATOR) generate-readmes

## generate — Regenerate READMEs + inventory + lifecycle reports
generate:
	$(ORCHESTRATOR) all --strict

## pre-slice-gate — Required gate before ADR-ACT-0008 first vertical slice (requires SONAR_TOKEN)
pre-slice-gate: compose format lint typecheck test test-compose audit security architecture
	$(call STEP,pre-slice-gate: validate slice readiness)
	npm run validate:slices
	$(call STEP,pre-slice-gate: database substrate)
	npm run db:migrate
	npm run db:seed
	$(call STEP,pre-slice-gate: platform-api tests)
	npm run test:platform-api
	$(call STEP,pre-slice-gate: frontend smoke)
	npm run test:frontend:run
	$(call STEP,pre-slice-gate: Sonar quality gate)
	@if [ -z "$$SONAR_TOKEN" ]; then \
		printf '$(RED)✗ SONAR_TOKEN not set. pre-slice-gate requires Sonar.\n'; \
		printf '  Set SONAR_TOKEN in .env or environment, then re-run.\n$(RESET)'; \
		exit 1; \
	fi
	$(MAKE) sonar
	@echo ""
	@printf '$(BOLD)$(GREEN)'
	@printf '  ┌─────────────────────────────────────────────────────┐\n'
	@printf '  │  pre-slice-gate PASSED                               │\n'
	@printf '  │  ADR-ACT-0008 first slice may now begin (Tier 1).   │\n'
	@printf '  └─────────────────────────────────────────────────────┘\n'
	@printf '$(RESET)'

## local-substrate-check — Local developer quick-check (NOT sufficient to begin ADR-ACT-0008)
local-substrate-check: compose format lint typecheck test test-compose audit architecture
	$(call STEP,local-substrate-check: database substrate)
	npm run db:migrate
	npm run db:seed
	$(call STEP,local-substrate-check: platform-api tests)
	npm run test:platform-api
	$(call STEP,local-substrate-check: frontend smoke)
	npm run test:frontend:run
	$(call OK,local-substrate-check complete)
	@printf '$(YELLOW)⚠ Sonar not run — this check is NOT sufficient for ADR-ACT-0008.\n'
	@printf '  Run: SONAR_TOKEN=<token> make pre-slice-gate$(RESET)\n'
