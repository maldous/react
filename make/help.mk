.PHONY: help infra-check readmes generate \
        pre-slice-gate local-substrate-check

## help — Show all documented targets
help:
	@printf '\n$(BOLD)maldous/react — platform Makefile$(RESET)\n'
	@printf '$(BOLD)make <target> [ENV=dev|test|staging|prod]$(RESET)   default ENV: dev\n'
	@printf '\n'
	@printf '$(BOLD)── DAILY WORKFLOW ───────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  check               'Fast local gate: format / lint / typecheck / architecture (no Sonar)' \
	  all                 'AUTHORITATIVE full confidence: V2 assurance + dev → test → staging → prod; Sonar gate runs at test' \
	  release-confidence  'Alias for make all (the authoritative full-confidence run, incl. the Sonar gate)' \
	  fix                 'Auto-fix Prettier formatting' \
	  install             'Install all npm dependencies (root + governance tools)'
	@printf '\n'
	@printf '$(BOLD)── DEVELOPMENT ──────────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  dev-up           'Start Tilt dev loop (Vite + API, blocks until healthy)' \
	  dev-down         'Stop Tilt dev stack'
	@printf '\n'
	@printf '$(BOLD)── ENVIRONMENTS  [ENV=test|staging|prod] ────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  test-up           'Full test stack: all compose profiles + web' \
	  test-down         'Stop test stack' \
	  staging-up        'Full staging stack: all compose profiles + web' \
	  staging-down      'Stop staging stack' \
	  prod-up           'Full production stack: all compose profiles + web' \
	  prod-down         'Stop prod stack' \
	  keycloak-provision 'Apply Terraform: provision Keycloak realm for ENV'
	@printf '\n'
	@printf '$(BOLD)── COMPOSE SERVICES  [ENV=test|staging|prod] ─────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  compose-up-default        'postgres redis clickhouse minio mailpit otel-collector' \
	  compose-up-identity       '+ Keycloak SSO (identity profile)' \
	  compose-up-observability  '+ Loki + Tempo + Grafana + Alloy (observability profile)' \
	  compose-up-cloud          '+ LocalStack / AWS mocks (cloud-mocks profile)' \
	  compose-up-external-mocks '+ WireMock (external-mocks profile)' \
	  compose-up-workflow-provider '+ Windmill + worker + postgres + redis (workflow-provider profile)' \
	  compose-up-pitr-provider  '+ pgBackRest PITR provider (pitr-provider profile)' \
	  compose-up-antivirus-provider '+ ClamAV malware scanning (antivirus-provider profile)' \
	  compose-up-web            '+ Caddy SPA + containerised platform-api' \
	  compose-down              'Stop all services for ENV' \
	  compose-down-reset        'Stop + reset app data (preserves Keycloak volume)' \
	  compose-ps                'Service health status for ENV' \
	  compose-logs              'Tail service logs for ENV'
	@printf '\n'
	@printf '$(BOLD)── SHARED SERVICES ───────────────────────────────────────────────────$(RESET)\n'
	@printf '  $(GREEN)%-28s$(RESET) %s\n' \
	  sentry-up           'Start shared Sentry (react-shared project, all envs)' \
	  sentry-down         'Stop shared Sentry' \
	  sonar-up            'Start shared SonarQube (react-sonar project, all envs)' \
	  sonar-provision     'Ensure a valid SonarQube analysis token (auto-gen from scratch)' \
	  sonar-down          'Stop shared SonarQube' \
	  external-caddy-up   'Start Caddy on port 80 (react-shared, Cloudflare routing)' \
	  external-caddy-down 'Stop external Caddy' \
	  compose-up-identity-mocks 'Start shared mock-oidc IdP fixture (react-shared)' \
	  identity-mocks-down 'Stop shared mock-oidc fixture'
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
	  v2-foundation-assurance 'Regenerate + verify V2 formal/USF runtime assurance and readiness' \
	  format       'Prettier — write then verify' \
	  lint         'Markdown lint + ESLint flat config' \
	  typecheck    'TypeScript strict (app + all packages)' \
	  audit        'npm audit (high/critical) + OSV vulnerability scan' \
	  security     'Secret scan via gitleaks' \
	  architecture 'Full architecture governance suite (--strict)' \
	  sonar        'Sonar scan + quality gate against shared instance' \
	  sbom         'Generate CycloneDX 1.6 SBOM' \
	  infra-check  'Validate Terraform syntax + format (no credentials needed)'
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

## readmes — Regenerate all package READMEs from metadata
readmes:
	$(ORCHESTRATOR) generate-readmes

## generate — Regenerate READMEs + inventory + lifecycle reports
generate:
	$(ORCHESTRATOR) all --strict

## pre-slice-gate — Required gate before ADR-ACT-0008 first vertical slice (requires .env.sonar with SONAR_TOKEN)
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
	@# ADR-0072: the sonar runtime env is generated from config/environments/shared.json.
	@bash scripts/env/resolve-env-file.sh sonar >/dev/null || { \
		printf '$(RED)✗ could not materialise .env/sonar.env (config/environments/shared.json).\n$(RESET)'; \
		exit 1; \
	}
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
	@printf '  Run: make sonar-up && make pre-slice-gate$(RESET)\n'
