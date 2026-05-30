# =============================================================================
# Platform Makefile ? maldous/react
# =============================================================================
# Usage:
#   make all           Run every check, test, audit, compose, and gate
#   make check         Fast local check (no sonar, no compose smoke tests)
#   make ci            CI-safe subset (no sonar, no smoke tests, no advisory)
#   make full          all + compose smoke tests
#   make fix           Auto-fix formatting
#   make clean         Remove generated artefacts
#   make help          Show all targets
#
# Sonar requires SONAR_TOKEN. Set it in .env or the environment:
#   echo 'SONAR_TOKEN=squ_...' >> .env
# =============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := all

# Load .env if present ? provides SONAR_TOKEN, SONAR_HOST_URL, etc.
-include .env
export

# Environment selector ? scopes all Compose operations to an isolated stack.
# Default: dev (backward compatible). Set to test, staging, or prod for parallel stacks.
# Each environment uses --project-name and --env-file for fully isolated containers,
# volumes, and networks across 4 concurrent stacks (ADR-ACT-0169).
ENV ?= dev

# PRESERVE_JVM_VOLUMES ? preserve Keycloak and SonarQube data when resetting app data.
# Default true: JVM services (Keycloak, SonarQube) are slow to re-initialize.
# Set to "false" to destroy ALL volumes including JVM (full clean state).
# Override per-invocation: PRESERVE_JVM_VOLUMES=false make stage-dev
PRESERVE_JVM_VOLUMES ?= true

# Compose command helper ? always scoped to the selected environment.
# All compose targets should use $(COMPOSE_CMD) instead of bare `docker compose`.
# Uses docker/compose-wrapper.sh which sources .env.$(ENV) before docker compose
# so its vars are available for compose.yaml interpolation.
# Docker Compose v5 uses --env-file only for container runtime env, not interpolation.
COMPOSE_CMD = docker/compose-wrapper.sh $(ENV)

# Terminal colours (gracefully degrade if tput is unavailable)
BOLD   := $(shell tput bold   2>/dev/null || true)
GREEN  := $(shell tput setaf 2 2>/dev/null || true)
BLUE   := $(shell tput setaf 4 2>/dev/null || true)
YELLOW := $(shell tput setaf 3 2>/dev/null || true)
RED    := $(shell tput setaf 1 2>/dev/null || true)
RESET  := $(shell tput sgr0   2>/dev/null || true)

STEP  = @printf '\n$(BOLD)$(BLUE)??? %-48s ???$(RESET)\n' "$(1)"
OK    = @printf '$(GREEN)? %s$(RESET)\n' "$(1)"
WARN  = @printf '$(YELLOW)? %s$(RESET)\n' "$(1)"
SKIP  = @printf '$(YELLOW)? %s$(RESET)\n' "$(1)"

# Orchestrator shorthand
ORCHESTRATOR = node tools/architecture/orchestrator/src/index.mjs

# =============================================================================
# PHONY DECLARATIONS
# =============================================================================
.PHONY: all help install \
        format lint typecheck \
        test test-compose \
        audit security \
        compose architecture \
        sonar advisory sbom license \
        check ci full fix clean \
        compose-up compose-up-default compose-up-quality \
        compose-up-identity compose-up-cloud compose-up-sentry compose-up-external-mocks compose-up-web \
        compose-down compose-down-volumes compose-down-reset compose-ps compose-logs \
        readmes generate infra-check pre-slice-gate local-substrate-check \
        keycloak-provision \
        e2e-internal e2e-internal-build e2e-external-smoke e2e-external-auth e2e-external \
        reset-local seed-demo db-migrate db-shell redis-flush-local \
        dev-up dev-up-minimal test-up staging-up prod-up \
        external-caddy-up external-caddy-down \
        dev-down test-down staging-down prod-down clean-all \
        dev-e2e dev-e2e-auth test-e2e staging-e2e prod-e2e \
        stage-dev stage-test stage-staging stage-prod \
        run-stage-tests run-stage-e2e

# =============================================================================
## all ? Complete promotion pipeline across all 4 environments
##
##   clean-all ? quality gates ? dev (Tilt) ? test ? staging (Cloudflare) ? prod (Cloudflare)
##
## Internal (dev + test): local Compose/Tilt, fixture sessions, data destructive.
## External (staging + prod): real Cloudflare-deployed environments, data preserving.
##
## One-time local setup:
##   echo "127.0.0.1 aldous.info" | sudo tee -a /etc/hosts
##   infra/env/dev/dev.tfvars (copy from dev.tfvars.example)
##   KEYCLOAK_TEST_USERNAME and KEYCLOAK_TEST_PASSWORD in .env
# =============================================================================
all: KEEP_STACKS_UP = true
all: clean-all \
     install format lint typecheck architecture audit security \
     stage-dev \
     stage-test \
     stage-staging \
     stage-prod \
     advisory sbom license
	@echo ""
	@printf '$(BOLD)$(GREEN)'
	@printf '  ????????????????????????????????????????????????????????\n'
	@printf '  ?  make all ? promotion pipeline complete             ?\n'
	@printf '  ?  4/4 stages passed: dev ? test ? staging ? prod    ?\n'
	@printf '  ????????????????????????????????????????????????????????\n'
	@printf '$(RESET)'
	@echo ""

# =============================================================================
## help ? Show all documented targets
# =============================================================================
help:
	@echo ""
	@echo "$(BOLD)Platform Makefile ? maldous/react$(RESET)"
	@echo ""
	@grep -E '^## [a-zA-Z_-]+' $(MAKEFILE_LIST) \
		| sed 's/^## //' \
		| awk -F ' ? ' '{ printf "  $(BOLD)%-22s$(RESET) %s\n", $$1, $$2 }'
	@echo ""

# =============================================================================
## install ? Install all npm dependencies (root + governance tools)
# =============================================================================
install:
	$(call STEP,install)
	npm ci
	@cd tools/architecture/validate-package-metadata && npm ci --silent
	@cd tools/architecture/validate-source-imports   && npm ci --silent
	@cd tools/architecture/validate-lifecycle-evidence && npm ci --silent
	$(call OK,dependencies installed)

# =============================================================================
## format ? Write Prettier formatting then verify
# =============================================================================
format:
	$(call STEP,format)
	npm run format:write
	npm run format:check
	$(call OK,formatting clean)

# =============================================================================
## lint ? Markdown lint (markdownlint-cli2) + ESLint flat config
# =============================================================================
lint:
	$(call STEP,lint)
	npm run lint:md
	npm run lint
	$(call OK,lint clean)

# =============================================================================
## typecheck ? TypeScript strict (app + all platform packages)
# =============================================================================
typecheck:
	$(call STEP,typecheck)
	npm run tsc:check
	$(call OK,TypeScript clean)

# =============================================================================
## test ? Run all 271 tests with V8 LCOV coverage
# =============================================================================
test:
	$(call STEP,test \(271 tests + LCOV coverage\))
	npm run test:coverage
	$(call OK,tests passed ? coverage/lcov.info generated)

# =============================================================================
## test-compose ? Compose service smoke tests (starts services if needed)
## Scoped to the selected ENV (default: dev).
# =============================================================================
test-compose:
	$(call STEP,test:compose ($(ENV)))
	@$(COMPOSE_CMD) ps postgres 2>/dev/null | grep -q "healthy" \
		|| (printf '$(YELLOW)$(ENV) services not running ? starting them...$(RESET)\n' \
		    && $(COMPOSE_CMD) up -d postgres redis clickhouse minio mailpit otel-collector \
		    && printf 'Waiting 20 s for healthchecks...\n' \
		    && sleep 20)
	npm run test:compose
	$(call OK,compose smoke tests passed ($(ENV)))

# =============================================================================
## audit ? npm audit (high/critical) + OSV vulnerability scanner
# =============================================================================
audit:
	$(call STEP,audit)
	npm run audit:deps
	npm run audit:osv
	$(call OK,no vulnerabilities)

# =============================================================================
## security ? Secret scan via gitleaks
# =============================================================================
security:
	$(call STEP,security \(gitleaks\))
	npm run secrets:scan
	$(call OK,no secrets detected)

# =============================================================================
## compose ? Validate compose.yaml syntax (no services started)
# =============================================================================
compose:
	$(call STEP,compose:config)
	npm run compose:config
	npm run compose:config:all
	$(call OK,all compose profiles valid)

# =============================================================================
## architecture ? Full architecture governance suite (--strict, 6/6)
# =============================================================================
architecture:
	$(call STEP,architecture governance)
	$(ORCHESTRATOR) all --no-reports --strict
	$(call OK,all architecture gates passed)

# =============================================================================
## sonar ? SonarQube scan + quality gate (requires SONAR_TOKEN)
##         Starts quality profile automatically if SonarQube is not healthy.
##         Not ENV-scoped ? SonarQube is a cross-cutting tool.
# =============================================================================
sonar:
	$(call STEP,sonar)
	@if [ -z "$$SONAR_TOKEN" ]; then \
		printf '$(YELLOW)? SONAR_TOKEN not set ? skipping Sonar scan.\n'; \
		printf '  Set SONAR_TOKEN in .env or environment to enable.\n$(RESET)'; \
	else \
		$(COMPOSE_CMD) --profile quality up -d --wait --wait-timeout 420 sonarqube 2>/dev/null \
			|| docker compose --profile quality up -d --wait --wait-timeout 420 sonarqube \
			|| { printf '$(RED)? SonarQube did not become healthy$(RESET)\n'; exit 1; }; \
		printf '$(GREEN)SonarQube is UP.$(RESET)\n'; \
		npm run sonar:clean \
			|| { printf '$(RED)? Sonar quality gate failed$(RESET)\n'; exit 1; }; \
		printf '$(GREEN)? Sonar quality gate passed$(RESET)\n'; \
	fi

# =============================================================================
## advisory ? Report-only gates (never fail make all)
##            Knip (unused exports/deps) + dependency-cruiser (graph smoke)
# =============================================================================
advisory:
	$(call STEP,advisory \(report-only ? never fails\))
	-npm run knip
	-npm run depcruise
	$(call OK,advisory complete)

# =============================================================================
## sbom ? Generate CycloneDX 1.6 SBOM to docs/evidence/security/
# =============================================================================
sbom:
	$(call STEP,sbom)
	npm run sbom:generate
	$(call OK,SBOM generated)

# =============================================================================
## license ? Show license policy status (documentation-only gate)
# =============================================================================
license:
	$(call STEP,license policy)
	npm run license:policy
	$(call OK,license policy noted)

# =============================================================================
# SHORTHAND COMPOSITE TARGETS
# =============================================================================

## check ? Fast local check: format/lint/typecheck/audit/compose/architecture
check: format lint typecheck audit compose architecture
	$(call OK,check complete)

## ci ? CI-safe subset: install/format/lint/typecheck/test/audit/security/compose/architecture
ci: install format lint typecheck test audit security compose architecture
	$(call OK,ci complete)

## full ? all + explicit compose smoke tests (alias for all which already includes test-compose)
full: all
	$(call OK,full run complete)

## fix ? Auto-fix all Prettier formatting issues
fix:
	$(call STEP,fix \(format:write\))
	npm run format:write
	$(call OK,formatting applied)

## clean ? Stop app services for the selected ENV, kill stale processes, remove artefacts.
## Stops only the current environment's services (default: dev).
## Use `make clean-all` to stop all 4 environments.
## Deliberately does NOT stop SonarQube (quality) or Keycloak (identity).
## Those are JVM services that take 2-4 min to restart and hold no app state.
## If already healthy they pass --no-recreate --wait instantly in make all.
## Use `ENV=test make compose-down-volumes` to wipe a specific environment's data.
clean:
	$(call STEP,clean: stopping $(ENV) services)
	$(COMPOSE_CMD) --profile web --profile cloud-mocks \
	    --profile sentry --profile external-mocks \
	    stop 2>/dev/null || true
	$(COMPOSE_CMD) stop postgres redis clickhouse minio mailpit otel-collector 2>/dev/null || true
	$(call STEP,clean: stopping default Tilt project)
	# Tilt uses the default compose project name ("react"), so make all needs
	# to clear that project too or its old Postgres volume can survive and
	# trigger migration checksum mismatches on the next dev stage.
	docker compose down --volumes 2>/dev/null || true
	$(call STEP,clean: nuking stale port-holding containers)
	# Force-remove ANY container publishing our ports, regardless of
	# Compose project name. Handles stale containers from old project
	# names (e.g. default directory-based 'react-*' containers that
	# survive ENV-scoped 'docker compose --project-name dev stop').
	# Also reads env-specific ports from .env.$(ENV) so per-environment
	# overrides (like OTEL_GRPC_PORT=4322) are covered.
	# Excludes JVM ports (8090 Keycloak, 9003 SonarQube) that are
	# deliberately preserved for fast restart.
	@for port in 3001 4317 4318 5173 5433 6379 8025 8089 8124 9000 9001 9002 10350 13133 \
	    $$(grep -oP '_PORT=\K\d+' .env.$(ENV) 2>/dev/null | grep -vw '8090\|9003'); do \
	    docker ps -q --filter "publish=$$port" 2>/dev/null | xargs -r docker rm -f 2>/dev/null; \
	done
	$(call STEP,clean: killing stale port holders)
	# Kill stale host-port holders (docker-proxy runs as root, so
	# fuser needs sudo). Covers all compose.yaml host ports and
	# reads env-specific port overrides from .env.$(ENV) dynamically.
	# Excludes JVM ports (8090 Keycloak, 9003 SonarQube) that are
	# deliberately preserved for fast restart.
	@sudo fuser -k \
	    80/tcp 1025/tcp 3001/tcp 4173/tcp 4317/tcp 4318/tcp 4566/tcp \
	    5173/tcp 5433/tcp 6379/tcp 8025/tcp 8089/tcp \
	    8124/tcp 9000/tcp 9001/tcp 9002/tcp 9010/tcp \
	    10350/tcp 13133/tcp \
	    $$(grep -oP '_PORT=\K\d+' .env.$(ENV) 2>/dev/null | grep -vw '8090\|9003' | sed 's/$$/\/tcp/' | tr '\n' ' ') \
	    2>/dev/null || true
	$(call STEP,clean: verifying ports free)
	# Verify all default ports + env-specific ports are free after cleanup
	@_all_ports="3001 4317 5173 5433 9000 10350 $$(grep -oP '_PORT=\K\d+' .env.$(ENV) 2>/dev/null | grep -vw '8090\|9003')"; \
	for port in $$_all_ports; do \
	    if ss -tlnp "sport = :$$port" 2>/dev/null | grep -q LISTEN; then \
	        printf '$(RED)? Port %s still in use$(RESET)\n' "$$port"; \
	        exit 1; \
	    fi; \
	done
	$(call STEP,clean: removing artefacts)
	rm -rf coverage/ reports/ .scannerwork/ playwright-report/ e2e-results/
	$(call OK,clean complete for $(ENV))

## clean-all ? Stop services for ALL 4 environments
clean-all:
	$(MAKE) clean ENV=dev
	$(MAKE) clean ENV=test
	$(MAKE) clean ENV=staging
	$(MAKE) clean ENV=prod
	$(call OK,all environments cleaned)

# =============================================================================
# COMPOSE LIFECYCLE HELPERS
# =============================================================================

## compose-up ? Start default services for the selected ENV
compose-up:
	$(COMPOSE_CMD) up -d

## compose-up-default ? Start exactly the 6 default services (idempotent)
## Accepts ENV=dev|test|staging|prod (default: dev)
compose-up-default:
	$(call STEP,compose:up:default ($(ENV)))
	$(COMPOSE_CMD) up -d postgres redis clickhouse minio mailpit otel-collector
	@printf 'Waiting for postgres to be healthy...\n'
	@timeout 60 bash -c 'until $(COMPOSE_CMD) ps postgres 2>/dev/null | grep -q healthy; do sleep 2; done' \
		|| (printf '$(RED)? postgres did not become healthy$(RESET)\n' && exit 1)
	$(call OK,default services healthy for $(ENV))

## compose-up-quality ? Start SonarQube (quality profile)
## Not ENV-scoped ? SonarQube is a cross-cutting tool.
compose-up-quality:
	docker compose --profile quality up -d --wait --wait-timeout 420 sonarqube

## compose-up-identity ? Start Keycloak (identity profile) and wait for it to be healthy.
## Scoped to ENV so each environment has its own Keycloak instance.
## --wait: return only when the container healthcheck passes (start_period:60s + retries).
## --wait-timeout 360: maximum wait (start_period:60s + interval:30s ? retries:10).
compose-up-identity:
	$(call STEP,compose: starting Keycloak ($(ENV)))
	$(COMPOSE_CMD) --profile identity up -d --wait --wait-timeout 360 keycloak
	$(call OK,Keycloak ready for $(ENV))

## keycloak-provision ? Apply Terraform to provision the platform Keycloak realm
## Scoped to ENV: each environment uses infra/env/$(ENV)/$(ENV).tfvars.
## Prerequisites: compose-up-identity for the selected environment.
keycloak-provision:
	$(call STEP,keycloak: provisioning realm via Terraform ($(ENV)))
	@_tfdir=infra/env/$(ENV); \
	if [ ! -f "$${_tfdir}/$(ENV).tfvars" ]; then \
		printf "$(RED)? Terraform vars not found in $${_tfdir}.\n"; \
		printf "  Copy $(ENV).tfvars.example to $(ENV).tfvars and fill in values.$(RESET)\n"; \
		exit 1; \
	fi; \
	cd $${_tfdir} && terraform init -upgrade -input=false > /dev/null 2>&1 \
	    && terraform apply -var-file=$(ENV).tfvars -auto-approve -input=false
	$(call OK,Keycloak realm provisioned for $(ENV))

# =============================================================================
# ENVIRONMENT-SPECIFIC TARGETS (ADR-0033)
#
# Dev:   APEX_DOMAIN=dev.localhost  ? auto-resolving .localhost TLD (RFC 6761)
# Test:  APEX_DOMAIN=test.localhost ? separate .localhost TLD for test/CI
# Prod:  APEX_DOMAIN=aldous.info    ? Cloudflare TLS, real DNS
# =============================================================================

## dev-up ? Full dev stack: default infra + identity + web (dev.localhost, port 80)
dev-up:
	$(call STEP,dev: full stack)
	$(MAKE) compose-up-default ENV=dev
	$(MAKE) compose-up-identity ENV=dev
	$(MAKE) keycloak-provision ENV=dev
	$(MAKE) compose-up-web ENV=dev

## dev-up-minimal ? Start only default infra for dev (no web, no Keycloak)
dev-up-minimal:
	$(call STEP,dev: up minimal)
	$(MAKE) compose-up-default ENV=dev

## test-up ? Full test stack: default infra + identity + web (test.localhost, port 81)
test-up:
	$(call STEP,test: full stack)
	$(MAKE) compose-up-default ENV=test
	$(MAKE) compose-up-identity ENV=test
	$(MAKE) keycloak-provision ENV=test
	$(MAKE) compose-up-web ENV=test

## staging-up ? Full staging stack (staging.aldous.info, port 82)
## Requires: 127.0.0.1 staging.aldous.info in /etc/hosts
staging-up:
	$(call STEP,staging: full stack)
	$(MAKE) compose-up-default ENV=staging
	$(MAKE) compose-up-identity ENV=staging
	$(MAKE) keycloak-provision ENV=staging
	$(MAKE) compose-up-web ENV=staging

## prod-up ? Full production-like stack (aldous.info, port 83)
## Requires: 127.0.0.1 aldous.info in /etc/hosts
prod-up:
	$(call STEP,prod: full stack)
	$(MAKE) compose-up-default ENV=prod
	$(MAKE) compose-up-identity ENV=prod
	$(MAKE) keycloak-provision ENV=prod
	$(MAKE) compose-up-web ENV=prod

## dev-down ? Stop dev stack
dev-down:
	$(MAKE) compose-down ENV=dev

## test-down ? Stop test stack
test-down:
	$(MAKE) compose-down ENV=test

## staging-down ? Stop staging stack
staging-down:
	$(MAKE) compose-down ENV=staging

## prod-down ? Stop production stack
prod-down:
	$(MAKE) compose-down ENV=prod

## dev-e2e ? Run E2E tests against dev (internal) environment
dev-e2e:
	$(call STEP,e2e: dev (internal))
	PROD_BASE_URL=http://dev.localhost:8080 \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,dev E2E passed)

## dev-e2e-auth ? Run auth E2E against dev (requires Keycloak)
dev-e2e-auth:
	$(call STEP,e2e: dev auth)
	PROD_BASE_URL=http://dev.localhost:8080 \
	APEX_DOMAIN=dev.localhost \
	npx playwright test --config playwright.external.config.ts e2e/external/login.spec.ts e2e/external/logout.spec.ts
	$(call OK,dev auth E2E passed)

## test-e2e ? Run E2E tests against test (internal) environment
test-e2e:
	$(call STEP,e2e: test (internal))
	PROD_BASE_URL=http://test.localhost \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,test E2E passed)

## staging-e2e ? Run E2E tests against staging (external) environment (localhost:82)
staging-e2e:
	$(call STEP,e2e: staging (external))
	PROD_BASE_URL=http://localhost:82 \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,staging E2E passed)

## prod-e2e ? Run E2E tests against prod-like (external) environment (localhost:83)
prod-e2e:
	$(call STEP,e2e: prod-like (external))
	PROD_BASE_URL=http://localhost:83 \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,prod-like E2E passed)

## external-caddy-up ? Start external Caddy on host port 80 (Cloudflare-facing)
## Routes staging.aldous.info ? localhost:82, aldous.info ? localhost:83.
## Requires: staging and/or prod internal Caddies running on their ports.
external-caddy-up:
	$(call STEP,external-caddy: startup)
	# Caddy starts in under 1s. No --wait needed ? the Caddyfile has no localhost
	# site block, so a container healthcheck wouldn't be meaningful here.
	docker compose --profile external-web up -d external-caddy
	@sleep 2
	$(call OK,external Caddy ready on port 80)

## external-caddy-down ? Stop external Caddy
external-caddy-down:
	docker compose --profile external-web down
	$(call OK,external Caddy stopped)

## compose-up-cloud ? Start LocalStack (cloud-mocks profile)
## Scoped to selected ENV for port isolation.
compose-up-cloud:
	$(COMPOSE_CMD) --profile cloud-mocks up -d localstack

## compose-up-sentry ? Start Sentry stack (sentry profile ? experimental)
## Scoped to selected ENV for port isolation.
compose-up-sentry:
	$(COMPOSE_CMD) --profile sentry up -d

## compose-up-external-mocks ? Start WireMock (external-mocks profile)
## Scoped to selected ENV for port isolation.
compose-up-external-mocks:
	$(COMPOSE_CMD) --profile external-mocks up -d wiremock

## compose-up-web ? Build and start the web profile for the selected ENV.
## Requires: default services + identity running for that environment.
## Accepts ENV=dev|test|staging|prod (default: dev).
## The web port is read from .env.$(ENV) for the healthcheck.
compose-up-web:
	$(call STEP,web:up ($(ENV)))
	@printf '$(BOLD)Building and starting web profile ($(ENV))$(RESET)\n'
	# --wait: wait for all services to pass Docker healthchecks. Respects the
	#   depends_on chain: platform-api must be healthy before react-app (Caddy)
	#   starts, then both must pass healthchecks before up returns.
	# --wait-timeout 420: 7-minute limit covering full build (npm ci + vite build)
	#   + platform-api startup (migrate ? seed ? serve) + Caddy startup.
	#   420s matches the sonar target's timeout for consistency.
	$(COMPOSE_CMD) --profile web up -d --build --wait --wait-timeout 420
	@_port=$$(grep '^WEB_HTTP_PORT=' .env.$(ENV) 2>/dev/null | head -1 | cut -d= -f2 || echo "80"); \
	_apex=$$(grep '^APEX_DOMAIN=' .env.$(ENV) 2>/dev/null | head -1 | cut -d= -f2 || echo "localhost"); \
	printf '$(GREEN)? Web profile for $(ENV) started ? http://%s:%s$(RESET)\n' "$${_apex}" "$${_port}"

## compose-down-web ? Stop and remove web profile containers for the selected ENV
compose-down-web:
	$(COMPOSE_CMD) --profile web down

## reset-local ? Reset local Postgres to a clean migrated+seeded state (destructive)
## Only runs against the local Compose DB (POSTGRES_URL defaults to localhost:5433)
reset-local:
	$(call STEP,reset:local)
	@printf '$(BOLD)$(RED)Resetting local database ? drops all tables, re-migrates, re-seeds$(RESET)\n'
	npm run db:reset
	npm run db:migrate
	npm run db:seed
	$(call OK,local database reset complete)

## seed-demo ? Seed fixture data into local Postgres (idempotent ? ON CONFLICT DO NOTHING)
seed-demo:
	$(call STEP,seed:demo)
	npm run db:seed
	$(call OK,fixture data seeded)

## db-migrate ? Run database migrations (idempotent)
db-migrate:
	$(call STEP,db:migrate)
	npm run db:migrate
	$(call OK,migrations complete)

## db-shell ? Open a psql shell to the selected ENV's Compose Postgres
db-shell:
	$(call STEP,db:shell ($(ENV)))
	$(COMPOSE_CMD) exec postgres psql -U $${POSTGRES_USER:-platform} -d $${POSTGRES_DB:-platform}

## redis-flush-local ? Flush all keys from the selected ENV's Compose Redis
redis-flush-local:
	$(call STEP,redis:flush:local ($(ENV)))
	@printf '$(BOLD)$(RED)Flushing Redis ($(ENV)) ? all sessions will be cleared$(RESET)\n'
	$(COMPOSE_CMD) exec redis redis-cli FLUSHALL
	$(call OK,Redis flushed for $(ENV))

## compose-down ? Stop all running compose services for the selected ENV
compose-down:
	$(COMPOSE_CMD) down

## compose-down-volumes ? Stop services and remove ALL named volumes for the selected ENV
## Destroys everything including Keycloak and SonarQube data.
compose-down-volumes:
	$(COMPOSE_CMD) down --volumes

## compose-down-reset ? Stop services and reset app data (preserves JVM volumes by default)
## Removes Postgres, Redis, ClickHouse, and MinIO data volumes for a clean app state.
## PRESERVE_JVM_VOLUMES=true (default): preserves Keycloak and SonarQube volumes (fast restart).
## PRESERVE_JVM_VOLUMES=false: destroys ALL volumes (same as compose-down-volumes).
compose-down-reset:
	$(call STEP,compose:down:reset ($(ENV)) ? app data reset)
	@if [ "$(PRESERVE_JVM_VOLUMES)" = "false" ]; then \
		printf '  PRESERVE_JVM_VOLUMES=false ? destroying ALL volumes including JVM\\n'; \
		$(COMPOSE_CMD) down --volumes; \
	else \
		$(COMPOSE_CMD) down; \
		printf '  Removing app data volumes (preserving Keycloak/SonarQube)...\\n'; \
		docker volume rm \
			$(ENV)_postgres-data \
			$(ENV)_redis-data \
			$(ENV)_clickhouse-data \
			$(ENV)_minio-data \
			$(if $(filter dev,$(ENV)),react_postgres-data react_redis-data react_clickhouse-data react_minio-data,) \
			2>/dev/null || true; \
	fi
	$(call OK,app data reset for $(ENV)$(if $(filter true,$(PRESERVE_JVM_VOLUMES)), ? JVM volumes preserved))

## compose-ps ? Show compose service status for the selected ENV
compose-ps:
	$(COMPOSE_CMD) ps

## compose-logs ? Follow compose logs for the selected ENV (Ctrl-C to exit)
compose-logs:
	$(COMPOSE_CMD) logs -f

# =============================================================================
# GOVERNANCE HELPERS
# =============================================================================

## infra-check ? Validate Terraform/OpenTofu syntax, format, init, and validate (no cloud credentials needed)
infra-check:
	$(call STEP,infra:check)
	@chmod +x infra/bin/tf
	@infra/bin/tf fmt -check -recursive infra/ \
		&& printf '$(GREEN)? terraform format clean$(RESET)\n' \
		|| { printf '$(YELLOW)? run: infra/bin/tf fmt -recursive infra/$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev init -backend=false -input=false > /dev/null 2>&1 \
		&& printf '$(GREEN)? infra/env/dev init ok$(RESET)\n' \
		|| { printf '$(YELLOW)? init failed ? check provider availability (requires internet for first run)$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev validate -no-color \
		&& printf '$(GREEN)? infra/env/dev validate ok$(RESET)\n' \
		|| { printf '$(RED)? infra/env/dev validate failed$(RESET)\n'; exit 1; }
	$(call OK,infra check complete)

## keycloak-plan-dev ? Plan Keycloak provisioning against dev Compose Keycloak
##   Requires: docker compose --profile identity up -d keycloak (localhost:8090)
##   Uses: infra/env/dev/dev.tfvars.example (placeholder secrets ? safe to plan)
keycloak-plan-dev:
	$(call STEP,keycloak:plan:dev)
	@chmod +x infra/bin/tf
	@printf '$(BOLD)Requires: docker compose --profile identity up -d keycloak$(RESET)\n'
	@curl -sf http://localhost:8090/kc/realms/master > /dev/null 2>&1 \
		|| { printf '$(RED)? Keycloak not reachable at http://localhost:8090/kc\n  Run: docker compose --profile identity up -d keycloak$(RESET)\n'; exit 1; }
	@printf '$(GREEN)? Keycloak reachable at http://localhost:8090/kc$(RESET)\n'
	@infra/bin/tf -chdir=infra/env/dev init -backend=false -input=false > /dev/null 2>&1 \
		&& printf '$(GREEN)? init ok$(RESET)\n' \
		|| { printf '$(RED)? init failed$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev validate -no-color \
		&& printf '$(GREEN)? validate ok$(RESET)\n' \
		|| { printf '$(RED)? validate failed$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/dev plan \
		-var-file=dev.tfvars.example \
		-input=false \
		-no-color
	$(call OK,keycloak plan complete ? review above before running apply)

## readmes ? Regenerate all package READMEs from metadata
readmes:
	$(ORCHESTRATOR) generate-readmes

## generate ? Regenerate READMEs + inventory + lifecycle reports
generate:
	$(ORCHESTRATOR) all --strict

## pre-slice-gate ? Required gate before ADR-ACT-0008 first vertical slice (requires SONAR_TOKEN)
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
	$(call STEP,pre-slice-gate: E2E substrate \(Tier 1 gate\))
	$(MAKE) e2e-check
	$(call STEP,pre-slice-gate: Sonar quality gate)
	@if [ -z "$$SONAR_TOKEN" ]; then \
		printf '$(RED)? SONAR_TOKEN not set. pre-slice-gate requires Sonar.\n'; \
		printf '  Set SONAR_TOKEN in .env or environment, then re-run.\n$(RESET)'; \
		exit 1; \
	fi
	$(MAKE) sonar
	@echo ""
	@printf '$(BOLD)$(GREEN)'
	@printf '  ????????????????????????????????????????????????????????\n'
	@printf '  ?  pre-slice-gate PASSED                               ?\n'
	@printf '  ?  ADR-ACT-0008 first slice may now begin (Tier 1).    ?\n'
	@printf '  ?  E2E substrate: PASSED                               ?\n'
	@printf '  ?  Real Keycloak login blocked until ADR-ACT-0110.     ?\n'
	@printf '  ????????????????????????????????????????????????????????\n'
	@printf '$(RESET)'

## e2e-internal ? Internal E2E: fixture session against localhost (Vite dev server)
## playwright.internal.config.ts starts platform-api + Vite dev server automatically.
## Accepts POSTGRES_URL and REDIS_URL overrides (e.g. from stage-test).
## Defaults to localhost:5433 and localhost:6379 when run standalone.
e2e-internal:
	$(call STEP,e2e:internal \(localhost fixture session\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)? Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	# Use make's $(or) to resolve env vars at make-expansion time (same pattern as run-stage-tests).
	# This ensures command-line overrides from stage targets are used correctly.
	POSTGRES_URL='$(or $(POSTGRES_URL),postgresql://platform:platformpassword@localhost:5433/platform)' \
	REDIS_URL='$(or $(REDIS_URL),redis://localhost:6379)' \
	LOCAL_FIXTURE_SESSION=tenant-admin npx playwright test --config playwright.internal.config.ts
	$(call OK,internal E2E passed)

## e2e-internal-build ? Internal build E2E: fixture session against production bundle
## playwright.build.config.ts builds the SPA then serves it with vite preview.
e2e-internal-build:
	$(call STEP,e2e:internal-build \(production bundle E2E\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)? Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	LOCAL_FIXTURE_SESSION=tenant-admin npx playwright test --config playwright.build.config.ts
	$(call OK,internal build E2E passed)

## e2e-external-smoke ? External smoke tests against a running stack (no auth required)
## Runs e2e/external/smoke.test.ts against PROD_BASE_URL.
e2e-external-smoke:
	$(call STEP,e2e:external-smoke \($${PROD_BASE_URL:-http://aldous.info}\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)? Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@BASE=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$$BASE/healthz" > /dev/null 2>&1; then \
		printf '$(RED)? $$BASE not reachable. Run: make compose-up-web$(RESET)\n'; \
		exit 1; \
	fi; \
	PROD_BASE_URL=$$BASE npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,external smoke tests passed)

## e2e-external-auth ? External auth E2E against a running stack (real Keycloak)
## Requires: KEYCLOAK_TEST_PASSWORD set. Skips gracefully if prerequisites not met.
e2e-external-auth:
	$(call STEP,e2e:external-auth \(Keycloak login ? gracefully skipped if not provisioned\))
	@if [ -z "$${KEYCLOAK_TEST_PASSWORD}" ]; then \
		$(call WARN,external-auth E2E skipped ? KEYCLOAK_TEST_PASSWORD not set); \
		exit 0; \
	fi
	@BASE=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$$BASE/healthz" > /dev/null 2>&1; then \
		printf '$(RED)? $$BASE not reachable.$(RESET)\n'; \
		exit 1; \
	fi; \
	PROD_BASE_URL=$$BASE npx playwright test --config playwright.external.config.ts \
	    e2e/external/login.spec.ts e2e/external/logout.spec.ts e2e/external/caddy-links.spec.ts e2e/external/auth-negative.spec.ts
	$(call OK,external auth E2E passed)

## e2e-external ? Full external E2E against PROD_BASE_URL (default: http://aldous.info)
## Called standalone for real Cloudflare: PROD_BASE_URL=https://aldous.info make e2e-external
## Requires: PROD_BASE_URL to resolve (127.0.0.1 in /etc/hosts for local, real DNS for Cloudflare)
e2e-external:
	$(call STEP,e2e:external \($${PROD_BASE_URL:-http://aldous.info}\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)? Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@BASE=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$$BASE/healthz" > /dev/null 2>&1; then \
		printf '$(RED)? $$BASE not reachable.\n'; \
		printf '  For local: ensure 127.0.0.1 aldous.info is in /etc/hosts and make compose-up-web has run.\n'; \
		printf '  For Cloudflare: ensure the site is deployed and accessible.$(RESET)\n'; \
		exit 1; \
	fi; \
	PROD_BASE_URL="$$BASE" npx playwright test --config playwright.external.config.ts
	$(call OK,external E2E passed)

# =============================================================================
# STAGE TARGETS ? Promotion pipeline (ADR-0033)
#
# Each stage starts the environment, runs the full test suite, and tears down.
# Internal (dev + test): fixture sessions, no real Keycloak required.
# External (staging + prod): real deployed stacks with auth.
# =============================================================================

## run-stage-tests ? Run the standard test suite against the active environment
## Requires: postgres + platform-api to be reachable.
## Accepts environment overrides: POSTGRES_URL, REDIS_URL.
run-stage-tests:
	$(call STEP,run-stage-tests ($(ENV)))
	# Use make's $(or) function to resolve POSTGRES_URL/REDIS_URL at make-expansion time
	# instead of relying on shell ${VAR:-default} which needs export to propagate
	# command-line overrides to the recipe environment.
	# $(or A,B) evaluates to A if A is non-empty, otherwise B (make's native expansion).
	POSTGRES_URL='$(or $(POSTGRES_URL),postgresql://platform:platformpassword@localhost:5433/platform)' \
	REDIS_URL='$(or $(REDIS_URL),redis://localhost:6379)' \
	npm run test:platform-api
	npm run test:frontend:run
	$(call OK,stage tests passed for $(ENV))

## run-stage-e2e ? Run E2E smoke tests against the active environment
## Uses PROD_BASE_URL derived from .env.$(ENV).
run-stage-e2e:
	$(call STEP,run-stage-e2e ($(ENV)))
	@_port=$$(grep '^WEB_HTTP_PORT=' .env.$(ENV) 2>/dev/null | head -1 | cut -d= -f2 || echo "80"); \
	_url="http://localhost:$${_port}"; \
	PROD_BASE_URL="$${_url}" npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,stage E2E passed for $(ENV))

## stage-dev ? Dev stage: clean behaviour (data destructive, internal E2E + test creation)
##
##   compose-down-volumes ? Tilt up ? internal tests ? Tilt down ? compose-down-volumes
##
## Data is destroyed before (clean slate) and after (cleanup). Confirms the
## application works correctly from scratch (clean behaviour).
## Runs internal E2E tests (fixture session) ? not external tests.
## Dev is also the test creation environment (ADR-0034).
## Uses Tilt (ADR-0027) for the fast dev feedback loop.
stage-dev:
	$(call STEP,stage:dev (Tilt ? destructive, internal E2E))
	# clean kills stale host processes (Tilt on 10350, Vite on 5173, etc.),
	# compose-down-reset resets app data volumes for a clean slate.
	$(MAKE) clean ENV=dev
	$(MAKE) compose-down-reset ENV=dev
	tilt up &
	_TILT_PID=$$!
	@printf 'Waiting for platform-api to be healthy (up to 120s)...\n'
	@timeout 120 bash -c 'until curl -fsS http://localhost:3001/healthz >/dev/null 2>&1; do sleep 2; done' \
		|| { printf '$(RED)? platform-api timeout$(RESET)\n'; kill %1 2>/dev/null || true; tilt down 2>/dev/null; exit 1; }
	@printf 'Waiting for react-app dev server (up to 120s)...\n'
	@timeout 120 bash -c 'until curl -fsS http://localhost:5173/ >/dev/null 2>&1; do sleep 2; done' \
		|| { printf '$(RED)? react-app timeout$(RESET)\n'; kill %1 2>/dev/null || true; tilt down 2>/dev/null; exit 1; }
	@printf 'Running database migrations and seeding...\n'
	npm run db:migrate && npm run db:seed \
	    && $(MAKE) run-stage-tests ENV=dev \
	    && $(MAKE) e2e-internal \
	    && printf '$(GREEN)? stage:dev passed$(RESET)\n'; _r=$$?; \
	if [ "$(KEEP_STACKS_UP)" != "true" ]; then \
	    tilt down; \
	    $(MAKE) compose-down-reset ENV=dev; \
	fi; \
	exit $$_r

## stage-test ? Test stage: clean behaviour (data destructive, internal + external E2E)
##
##   compose-down-volumes ? Compose up ? internal tests ? external smoke ? compose-down-volumes
##
## Data is destroyed before (clean slate) and after (cleanup). Confirms the
## application works correctly from scratch with a full Compose stack.
## Runs internal E2E (common with dev) followed by external smoke for validation (ADR-0034).
## Uses Compose with --project-name test (port 81).
stage-test:
	$(call STEP,stage:test (Compose ? destructive, internal + external E2E))
	$(MAKE) compose-down-reset ENV=test
	$(call STEP,stage:test: freeing ports for test)
	@_all_ports="3001 4317 5173 5433 6379 8025 8089 8124 9000 9001 9002 10350 13133 $$(grep -oP '_PORT=\K\d+' .env.test 2>/dev/null)"; \
	for port in $$_all_ports; do \
	    docker ps -q --filter "publish=$$port" 2>/dev/null | xargs -r docker rm -f 2>/dev/null; \
	done; \
	sudo fuser -k $$(printf '%s/tcp ' $$_all_ports) 2>/dev/null || true; \
	for port in $$_all_ports; do \
	    if ss -tlnp "sport = :$$port" 2>/dev/null | grep -q LISTEN; then \
	        printf '$(RED)? Port %s still held after container nuke + fuser$(RESET)\n' "$$port"; \
	        exit 1; \
	    fi; \
	done
	$(MAKE) test-up
	@printf 'Running database migrations and seeding (test, port 5434)...\n'
	POSTGRES_URL=postgresql://platform:platformpassword@localhost:5434/platform \
	REDIS_URL=redis://localhost:6380 \
	npm run db:migrate \
	    && POSTGRES_URL=postgresql://platform:platformpassword@localhost:5434/platform \
	       REDIS_URL=redis://localhost:6380 \
	    npm run db:seed \
	    && $(MAKE) run-stage-tests ENV=test \
	        POSTGRES_URL='postgresql://platform:platformpassword@localhost:5434/platform' \
	        REDIS_URL='redis://localhost:6380' \
	    && $(MAKE) e2e-internal \
	        POSTGRES_URL='postgresql://platform:platformpassword@localhost:5434/platform' \
	        REDIS_URL='redis://localhost:6380' \
	    && $(MAKE) run-stage-e2e ENV=test \
	    && printf '$(GREEN)? stage:test passed$(RESET)\n'; _r=$$?; \
	if [ "$(KEEP_STACKS_UP)" != "true" ]; then \
	    $(MAKE) compose-down-reset ENV=test; \
	fi; \
	test $$_r -eq 0 || exit 1

## stage-staging ? Staging stage: preservation testing (data preserving, Cloudflare external)
##
##   external-caddy:up ? staging-up ? E2E tests ? staging-down ? external-caddy:down
##
## Starts the staging internal Compose stack (platform-api + SPA on port 82)
## and the external Caddy on port 80 (routes staging.aldous.info ? localhost:82).
## Cloudflare terminates TLS and forwards to the external Caddy.
##
## Prerequisites:
##   - staging.aldous.info must be DNS-resolvable to Cloudflare IPs
##     (no /etc/hosts override ? toggle with # if needed for local dev)
##   - KEYCLOAK_TEST_PASSWORD must be set for auth tests (optional ? skipped)
stage-staging:
	$(call STEP,stage:staging (Cloudflare external ? preserving))
	# clean intentionally skipped — staging data is preserved across runs; run manually if needed
	$(MAKE) compose-down ENV=staging
	@sudo fuser -k 8090/tcp 2>/dev/null || true
	$(MAKE) staging-up
	$(MAKE) external-caddy-up
	@printf 'Running database migrations (staging, port 5435 ? data preserving)...\n'
	POSTGRES_URL=postgresql://platform:platformpassword@localhost:5435/platform npm run db:migrate \
	    && $(MAKE) run-stage-tests ENV=staging \
	        POSTGRES_URL='postgresql://platform:platformpassword@localhost:5435/platform' \
	        REDIS_URL='redis://localhost:6381' \
	&& PROD_BASE_URL='$(or $(PROD_BASE_URL),http://staging.aldous.info)' $(MAKE) e2e-external \
	    && printf '$(GREEN)? stage:staging passed$(RESET)\n'; _r=$$?; \
	if [ "$(KEEP_STACKS_UP)" != "true" ]; then \
	    $(MAKE) external-caddy-down; \
	    $(MAKE) compose-down ENV=staging; \
	fi; \
	test $$_r -eq 0 || exit 1

## stage-prod ? Production stage: preservation confirmation (data preserving, Cloudflare external, exhaustive)
##
##   external-caddy:up ? prod-up ? external E2E ? exhaustive prod E2E ? prod-down ? external-caddy:down
##
## Starts the production internal Compose stack (platform-api + SPA on port 83)
## and the external Caddy on port 80 (routes aldous.info ? localhost:83).
## Cloudflare terminates TLS and forwards to the external Caddy.
## Runs the full external suite followed by exhaustive prod tests (ADR-0034).
##
## Prerequisites:
##   - aldous.info must be DNS-resolvable to Cloudflare IPs
##     (no /etc/hosts override ? toggle with # if needed for local dev)
##   - KEYCLOAK_TEST_PASSWORD must be set for auth tests (optional ? skipped)
stage-prod:
	$(call STEP,stage:prod (Cloudflare external ? preserving, exhaustive))
	# clean intentionally skipped — prod data is preserved across runs; run manually if needed
	$(MAKE) compose-down ENV=prod
	@sudo fuser -k 8090/tcp 2>/dev/null || true
	$(MAKE) prod-up
	$(MAKE) external-caddy-up
	@printf 'Running database migrations (prod, port 5436 ? data preserving)...\n'
	POSTGRES_URL=postgresql://platform:platformpassword@localhost:5436/platform npm run db:migrate \
	    && $(MAKE) run-stage-tests ENV=prod \
	        POSTGRES_URL='postgresql://platform:platformpassword@localhost:5436/platform' \
	        REDIS_URL='redis://localhost:6382' \
	    && PROD_BASE_URL='$(or $(PROD_BASE_URL),http://aldous.info)' $(MAKE) e2e-external \
	    && npm run test:e2e:prod \
	    && printf '$(GREEN)? stage:prod passed$(RESET)\n'; _r=$$?; \
	if [ "$(KEEP_STACKS_UP)" != "true" ]; then \
	    $(MAKE) external-caddy-down; \
	    $(MAKE) compose-down ENV=prod; \
	fi; \
	test $$_r -eq 0 || exit 1

## local-substrate-check ? Local developer quick-check (NOT sufficient to begin ADR-ACT-0008)
local-substrate-check: compose format lint typecheck test test-compose audit architecture
	$(call STEP,local-substrate-check: database substrate)
	npm run db:migrate
	npm run db:seed
	$(call STEP,local-substrate-check: platform-api tests)
	npm run test:platform-api
	$(call STEP,local-substrate-check: frontend smoke)
	npm run test:frontend:run
	$(call OK,local-substrate-check complete)
	@printf '$(YELLOW)? Sonar not run ? this check is NOT sufficient to begin ADR-ACT-0008.\n'
	@printf '  Run: SONAR_TOKEN=<token> make pre-slice-gate$(RESET)\n'
