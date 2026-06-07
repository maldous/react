.PHONY: help infra-check keycloak-plan-dev readmes generate \
        pre-slice-gate local-substrate-check

## help — Show all documented targets
help:
	@printf '\n$(BOLD)maldous/react — platform Makefile$(RESET)\n'
	@printf '$(BOLD)make <target> [ENV=dev|test|staging|prod]$(RESET)   default ENV: dev\n'
	@printf '\n'
	@printf '$(BOLD)── DAILY WORKFLOW ───────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  check        'Fast local gate: format / lint / typecheck / architecture' \
	  all          'Full confidence ladder: preflight → dev → test → staging → prod' \
	  fix          'Auto-fix Prettier formatting' \
	  install      'Install all npm dependencies (root + governance tools)'
	@printf '\n'
	@printf '$(BOLD)── DEVELOPMENT ──────────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  tilt-up          'Hot-reload dev loop (Vite + API, blocks until healthy)' \
	  tilt-down        'Stop Tilt dev stack' \
	  dev-up           'Full dev Compose stack (all profiles)' \
	  dev-up-minimal   'Core infra only (Postgres / Redis / ClickHouse / MinIO)' \
	  dev-down         'Stop dev stack'
	@printf '\n'
	@printf '$(BOLD)── COMPOSE SERVICES  [ENV=dev|test|staging|prod] ────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  compose-up-default        'postgres redis clickhouse minio mailpit otel-collector' \
	  compose-up-identity       '+ Keycloak SSO (identity profile)' \
	  compose-up-observability  '+ Loki + Grafana + Alloy (observability profile)' \
	  compose-up-quality        '+ SonarQube (quality profile)' \
	  compose-up-cloud          '+ LocalStack / AWS mocks (cloud-mocks profile)' \
	  compose-up-external-mocks '+ WireMock (external-mocks profile)' \
	  compose-up-sentry         '+ Sentry self-hosted (shared react-sentry project)' \
	  compose-up-web            '+ Caddy SPA + containerised platform-api' \
	  compose-down              'Stop all services for ENV' \
	  compose-down-reset        'Stop + reset app data (preserves Keycloak / SonarQube volumes)' \
	  compose-ps                'Service health status for ENV' \
	  compose-logs              'Tail service logs for ENV'
	@printf '\n'
	@printf '$(BOLD)── DATABASE ─────────────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  db-migrate        'Run pending migrations (idempotent)' \
	  db-shell          'Open psql shell for ENV Postgres' \
	  seed-demo         'Seed fixture organisations and users (idempotent)' \
	  reset-local       'Full reset: destroy + migrate + seed (destructive)' \
	  redis-flush-local 'Flush all Redis keys for ENV'
	@printf '\n'
	@printf '$(BOLD)── TESTING ──────────────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  run-stage-tests     'Unit / integration / E2E suite for ENV' \
	  e2e-internal        'E2E — fixture session, Vite dev server' \
	  e2e-internal-build  'E2E — fixture session, production build' \
	  e2e-external        'E2E — real Keycloak, PROD_BASE_URL (default: aldous.info)' \
	  e2e-external-smoke  'Smoke only, no auth required' \
	  e2e-external-auth   'Auth E2E — requires KEYCLOAK_TEST_PASSWORD'
	@printf '\n'
	@printf '$(BOLD)── STAGE PROMOTION ──────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  all           'Full ladder: preflight → dev → test → staging → prod + evidence' \
	  preflight     'Check binaries, Docker, env files, port conflicts' \
	  stage-dev     'Dev stage (Tilt, volatile data, all test groups)' \
	  stage-test    'Test stage (Compose, volatile data, all test groups)' \
	  stage-staging 'Staging stage (Compose, seeded data, all test groups)' \
	  stage-prod    'Prod stage (Compose, seeded data, smoke only)' \
	  promote       'Promote dev → test → staging → prod (no preflight)' \
	  evidence      'Write docs/evidence/stages/summary.json' \
	  env-up-all    'Start all 4 environments simultaneously' \
	  env-down-all  'Stop all 4 environments' \
	  env-status    'Container health for all 4 environments'
	@printf '\n'
	@printf '$(BOLD)── QUALITY GATES ────────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  quality      'Full quality gate (format + lint + typecheck + audit + security + arch)' \
	  format       'Prettier — write then verify' \
	  lint         'Markdown lint + ESLint flat config' \
	  typecheck    'TypeScript strict (app + all packages)' \
	  audit        'npm audit (high/critical) + OSV vulnerability scan' \
	  security     'Secret scan via gitleaks' \
	  architecture 'Full architecture governance suite (--strict)' \
	  sonar        'SonarQube scan + quality gate (requires SONAR_TOKEN)' \
	  sbom         'Generate CycloneDX 1.6 SBOM'
	@printf '\n'
	@printf '$(BOLD)── IDENTITY / INFRA ─────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  keycloak-provision  'Apply Terraform: provision Keycloak realm for ENV' \
	  keycloak-plan-dev   'Terraform plan against dev Keycloak (dry-run, no secrets)' \
	  infra-check         'Validate Terraform syntax + format (no credentials needed)' \
	  sentry-up           'Start shared Sentry instance (react-sentry project)' \
	  sentry-down         'Stop shared Sentry instance' \
	  external-caddy-up   'Start Caddy on port 80 (Cloudflare / aldous.info routing)' \
	  external-caddy-down 'Stop external Caddy'
	@printf '\n'
	@printf '$(BOLD)── MAINTENANCE ──────────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  readmes  'Regenerate all package READMEs from metadata' \
	  generate 'Regenerate READMEs + inventory + lifecycle reports' \
	  license  'Show license policy status' \
	  help     'Show this help'
	@printf '\n'

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
