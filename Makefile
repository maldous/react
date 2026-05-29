# =============================================================================
# Platform Makefile — maldous/react
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

# Load .env if present — provides SONAR_TOKEN, SONAR_HOST_URL, etc.
-include .env
export

# Terminal colours (gracefully degrade if tput is unavailable)
BOLD   := $(shell tput bold   2>/dev/null || true)
GREEN  := $(shell tput setaf 2 2>/dev/null || true)
BLUE   := $(shell tput setaf 4 2>/dev/null || true)
YELLOW := $(shell tput setaf 3 2>/dev/null || true)
RED    := $(shell tput setaf 1 2>/dev/null || true)
RESET  := $(shell tput sgr0   2>/dev/null || true)

STEP  = @printf '\n$(BOLD)$(BLUE)━━━ %-48s ━━━$(RESET)\n' "$(1)"
OK    = @printf '$(GREEN)✓ %s$(RESET)\n' "$(1)"
WARN  = @printf '$(YELLOW)⚠ %s$(RESET)\n' "$(1)"
SKIP  = @printf '$(YELLOW)↷ %s$(RESET)\n' "$(1)"

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
        compose-down compose-down-volumes compose-ps compose-logs \
        readmes generate infra-check pre-slice-gate local-substrate-check \
        e2e-check e2e-local e2e-build-prod e2e-web-smoke e2e-real-auth \
        reset-local seed-demo db-migrate db-shell redis-flush-local

# =============================================================================
## all — Increasingly strict quality gauntlet ending in production smoke
##
## Tier 1 — Quality gates (fast, no services):
##   install → format → lint → typecheck → architecture → audit → security
## Tier 2 — Unit + integration tests:
##   test → test-compose → sonar → advisory → sbom → license
## Tier 3 — Local E2E (dev-server, fixture session):
##   e2e-local
## Tier 4 — Production build + E2E (prod build via vite preview):
##   e2e-build-prod
## Tier 5 — Web profile up + aldous.info smoke (fixture session via Caddy):
##   compose-up-web → e2e-web-smoke
## Tier 6 — Real Keycloak login E2E (skipped gracefully if Keycloak not running):
##   e2e-real-auth
# =============================================================================
all: install format lint typecheck architecture audit security \
     test test-compose sonar advisory sbom license \
     e2e-local \
     e2e-build-prod \
     compose-up-web e2e-web-smoke \
     e2e-real-auth
	@echo ""
	@printf '$(BOLD)$(GREEN)'
	@printf '  ╔══════════════════════════════════════════════════════╗\n'
	@printf '  ║  make all — full gauntlet complete                   ║\n'
	@printf '  ║  Quality → Tests → Local E2E → Prod E2E → Smoke     ║\n'
	@printf '  ╚══════════════════════════════════════════════════════╝\n'
	@printf '$(RESET)'
	@echo ""

# =============================================================================
## help — Show all documented targets
# =============================================================================
help:
	@echo ""
	@echo "$(BOLD)Platform Makefile — maldous/react$(RESET)"
	@echo ""
	@grep -E '^## [a-zA-Z_-]+' $(MAKEFILE_LIST) \
		| sed 's/^## //' \
		| awk -F ' — ' '{ printf "  $(BOLD)%-22s$(RESET) %s\n", $$1, $$2 }'
	@echo ""

# =============================================================================
## install — Install all npm dependencies (root + governance tools)
# =============================================================================
install:
	$(call STEP,install)
	npm ci
	@cd tools/architecture/validate-package-metadata && npm ci --silent
	@cd tools/architecture/validate-source-imports   && npm ci --silent
	@cd tools/architecture/validate-lifecycle-evidence && npm ci --silent
	$(call OK,dependencies installed)

# =============================================================================
## format — Write Prettier formatting then verify
# =============================================================================
format:
	$(call STEP,format)
	npm run format:write
	npm run format:check
	$(call OK,formatting clean)

# =============================================================================
## lint — Markdown lint (markdownlint-cli2) + ESLint flat config
# =============================================================================
lint:
	$(call STEP,lint)
	npm run lint:md
	npm run lint
	$(call OK,lint clean)

# =============================================================================
## typecheck — TypeScript strict (app + all platform packages)
# =============================================================================
typecheck:
	$(call STEP,typecheck)
	npm run tsc:check
	$(call OK,TypeScript clean)

# =============================================================================
## test — Run all 271 tests with V8 LCOV coverage
# =============================================================================
test:
	$(call STEP,test \(271 tests + LCOV coverage\))
	npm run test:coverage
	$(call OK,tests passed — coverage/lcov.info generated)

# =============================================================================
## test-compose — Compose service smoke tests (starts services if needed)
# =============================================================================
test-compose:
	$(call STEP,test:compose \(compose service smoke tests\))
	@docker compose ps postgres 2>/dev/null | grep -q "healthy" \
		|| (printf '$(YELLOW)Default services not running — starting them...$(RESET)\n' \
		    && docker compose up -d postgres redis clickhouse minio mailpit otel-collector \
		    && printf 'Waiting 20 s for healthchecks...\n' \
		    && sleep 20)
	npm run test:compose
	$(call OK,compose smoke tests passed)

# =============================================================================
## audit — npm audit (high/critical) + OSV vulnerability scanner
# =============================================================================
audit:
	$(call STEP,audit)
	npm run audit:deps
	npm run audit:osv
	$(call OK,no vulnerabilities)

# =============================================================================
## security — Secret scan via gitleaks
# =============================================================================
security:
	$(call STEP,security \(gitleaks\))
	npm run secrets:scan
	$(call OK,no secrets detected)

# =============================================================================
## compose — Validate compose.yaml syntax (no services started)
# =============================================================================
compose:
	$(call STEP,compose:config)
	npm run compose:config
	npm run compose:config:all
	$(call OK,all compose profiles valid)

# =============================================================================
## architecture — Full architecture governance suite (--strict, 6/6)
# =============================================================================
architecture:
	$(call STEP,architecture governance)
	$(ORCHESTRATOR) all --no-reports --strict
	$(call OK,all architecture gates passed)

# =============================================================================
## sonar — SonarQube scan + quality gate (requires SONAR_TOKEN)
##         Starts quality profile automatically if SonarQube is not healthy.
# =============================================================================
sonar:
	$(call STEP,sonar)
	@if [ -z "$$SONAR_TOKEN" ]; then \
		printf '$(YELLOW)⚠ SONAR_TOKEN not set — skipping Sonar scan.\n'; \
		printf '  Set SONAR_TOKEN in .env or environment to enable.\n$(RESET)'; \
	else \
		docker compose --profile quality ps sonarqube 2>/dev/null | grep -q "healthy" \
			|| (printf '$(YELLOW)Starting SonarQube (quality profile)...$(RESET)\n' \
			    && docker compose --profile quality up -d sonarqube \
			    && printf 'Waiting for SonarQube to become UP (up to 120 s)...\n' \
			    && timeout 120 bash -c \
			         'until curl -sf http://$${SONAR_HOST_URL:-localhost:9003}/api/system/status \
			                | grep -q "\"status\":\"UP\""; do sleep 5; done' \
			    && printf '$(GREEN)SonarQube is UP.$(RESET)\n'); \
		npm run sonar:clean; \
		printf '$(GREEN)✓ Sonar quality gate passed$(RESET)\n'; \
	fi

# =============================================================================
## advisory — Report-only gates (never fail make all)
##            Knip (unused exports/deps) + dependency-cruiser (graph smoke)
# =============================================================================
advisory:
	$(call STEP,advisory \(report-only — never fails\))
	-npm run knip
	-npm run depcruise
	$(call OK,advisory complete)

# =============================================================================
## sbom — Generate CycloneDX 1.6 SBOM to docs/evidence/security/
# =============================================================================
sbom:
	$(call STEP,sbom)
	npm run sbom:generate
	$(call OK,SBOM generated)

# =============================================================================
## license — Show license policy status (documentation-only gate)
# =============================================================================
license:
	$(call STEP,license policy)
	npm run license:policy
	$(call OK,license policy noted)

# =============================================================================
# SHORTHAND COMPOSITE TARGETS
# =============================================================================

## check — Fast local check: format/lint/typecheck/audit/compose/architecture
check: format lint typecheck audit compose architecture
	$(call OK,check complete)

## ci — CI-safe subset: install/format/lint/typecheck/test/audit/security/compose/architecture
ci: install format lint typecheck test audit security compose architecture
	$(call OK,ci complete)

## full — all + explicit compose smoke tests (alias for all which already includes test-compose)
full: all
	$(call OK,full run complete)

## fix — Auto-fix all Prettier formatting issues
fix:
	$(call STEP,fix \(format:write\))
	npm run format:write
	$(call OK,formatting applied)

## clean — Remove generated artefacts (coverage, reports, sonar work)
clean:
	$(call STEP,clean)
	rm -rf coverage/ reports/ .scannerwork/
	$(call OK,artefacts removed)

# =============================================================================
# COMPOSE LIFECYCLE HELPERS
# =============================================================================

## compose-up — Start default services (postgres redis clickhouse minio mailpit otel-collector)
compose-up:
	docker compose up -d

## compose-up-default — Start exactly the 6 default services
compose-up-default:
	docker compose up -d postgres redis clickhouse minio mailpit otel-collector

## compose-up-quality — Start SonarQube (quality profile)
compose-up-quality:
	docker compose --profile quality up -d sonarqube

## compose-up-identity — Start Keycloak (identity profile)
compose-up-identity:
	docker compose --profile identity up -d keycloak

## compose-up-cloud — Start LocalStack (cloud-mocks profile)
compose-up-cloud:
	docker compose --profile cloud-mocks up -d localstack

## compose-up-sentry — Start Sentry stack (sentry profile — experimental)
compose-up-sentry:
	docker compose --profile sentry up -d

## compose-up-external-mocks — Start WireMock (external-mocks profile)
## Use for local development and E2E when adapters call external HTTP APIs.
compose-up-external-mocks:
	docker compose --profile external-mocks up -d wiremock

## compose-up-web — Build and start the web profile (platform-api + react SPA on :80)
## Requires: default services running; port 80 must be free.
## LOCAL_FIXTURE_SESSION defaults to empty (real Keycloak login required).
## For fixture-session testing: LOCAL_FIXTURE_SESSION=tenant-admin make compose-up-web
compose-up-web:
	$(call STEP,web:up)
	@printf '$(BOLD)Building and starting web profile (platform-api + react-app)$(RESET)\n'
	docker compose --profile web up -d --build
	@printf 'Waiting for platform-api health...\n'
	@timeout 60 bash -c 'until curl -fsS http://aldous.info/healthz >/dev/null 2>&1; do sleep 2; done' \
		|| (printf '$(YELLOW)⚠ aldous.info not healthy after 60s. Check /etc/hosts and compose-ps.$(RESET)\n')
	$(call OK,web profile started — http://aldous.info)

## compose-down-web — Stop and remove web profile containers
compose-down-web:
	docker compose --profile web down

## reset-local — Reset local Postgres to a clean migrated+seeded state (destructive)
## Only runs against the local Compose DB (POSTGRES_URL defaults to localhost:5433)
reset-local:
	$(call STEP,reset:local)
	@printf '$(BOLD)$(RED)Resetting local database — drops all tables, re-migrates, re-seeds$(RESET)\n'
	npm run db:reset
	npm run db:migrate
	npm run db:seed
	$(call OK,local database reset complete)

## seed-demo — Seed fixture data into local Postgres (idempotent — ON CONFLICT DO NOTHING)
seed-demo:
	$(call STEP,seed:demo)
	npm run db:seed
	$(call OK,fixture data seeded)

## db-migrate — Run database migrations (idempotent)
db-migrate:
	$(call STEP,db:migrate)
	npm run db:migrate
	$(call OK,migrations complete)

## db-shell — Open a psql shell to the local Compose Postgres
db-shell:
	$(call STEP,db:shell)
	docker compose exec postgres psql -U $${POSTGRES_USER:-platform} -d $${POSTGRES_DB:-platform}

## redis-flush-local — Flush all keys from local Compose Redis (destructive — clears sessions)
redis-flush-local:
	$(call STEP,redis:flush:local)
	@printf '$(BOLD)$(RED)Flushing local Redis — all sessions will be cleared$(RESET)\n'
	docker compose exec redis redis-cli FLUSHALL
	$(call OK,Redis flushed)

## compose-down — Stop all running compose services
compose-down:
	docker compose down

## compose-down-volumes — Stop services and remove named volumes
compose-down-volumes:
	docker compose down --volumes

## compose-ps — Show compose service status
compose-ps:
	docker compose ps

## compose-logs — Follow compose logs (Ctrl-C to exit)
compose-logs:
	docker compose logs -f

# =============================================================================
# GOVERNANCE HELPERS
# =============================================================================

## infra-check — Validate Terraform/OpenTofu syntax, format, init, and validate (no cloud credentials needed)
infra-check:
	$(call STEP,infra:check)
	@chmod +x infra/bin/tf
	@infra/bin/tf fmt -check -recursive infra/ \
		&& printf '$(GREEN)✓ terraform format clean$(RESET)\n' \
		|| { printf '$(YELLOW)⚠ run: infra/bin/tf fmt -recursive infra/$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/local init -backend=false -input=false > /dev/null 2>&1 \
		&& printf '$(GREEN)✓ infra/env/local init ok$(RESET)\n' \
		|| { printf '$(YELLOW)⚠ init failed — check provider availability (requires internet for first run)$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/local validate -no-color \
		&& printf '$(GREEN)✓ infra/env/local validate ok$(RESET)\n' \
		|| { printf '$(RED)✗ infra/env/local validate failed$(RESET)\n'; exit 1; }
	$(call OK,infra check complete)

## keycloak-plan-local — Plan Keycloak provisioning against local Compose Keycloak
##   Requires: docker compose --profile identity up -d keycloak (localhost:8080)
##   Uses: infra/env/local/local.tfvars.example (placeholder secrets — safe to plan)
keycloak-plan-local:
	$(call STEP,keycloak:plan:local)
	@chmod +x infra/bin/tf
	@printf '$(BOLD)Requires: docker compose --profile identity up -d keycloak$(RESET)\n'
	@curl -sf http://localhost:8080/realms/master > /dev/null 2>&1 \
		|| { printf '$(RED)✗ Keycloak not reachable at http://localhost:8080\n  Run: docker compose --profile identity up -d keycloak$(RESET)\n'; exit 1; }
	@printf '$(GREEN)✓ Keycloak reachable at http://localhost:8080$(RESET)\n'
	@infra/bin/tf -chdir=infra/env/local init -backend=false -input=false > /dev/null 2>&1 \
		&& printf '$(GREEN)✓ init ok$(RESET)\n' \
		|| { printf '$(RED)✗ init failed$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/local validate -no-color \
		&& printf '$(GREEN)✓ validate ok$(RESET)\n' \
		|| { printf '$(RED)✗ validate failed$(RESET)\n'; exit 1; }
	@infra/bin/tf -chdir=infra/env/local plan \
		-var-file=local.tfvars.example \
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
	$(call STEP,pre-slice-gate: E2E substrate \(Tier 1 gate\))
	$(MAKE) e2e-check
	$(call STEP,pre-slice-gate: Sonar quality gate)
	@if [ -z "$$SONAR_TOKEN" ]; then \
		printf '$(RED)✗ SONAR_TOKEN not set. pre-slice-gate requires Sonar.\n'; \
		printf '  Set SONAR_TOKEN in .env or environment, then re-run.\n$(RESET)'; \
		exit 1; \
	fi
	$(MAKE) sonar
	@echo ""
	@printf '$(BOLD)$(GREEN)'
	@printf '  ╔══════════════════════════════════════════════════════╗\n'
	@printf '  ║  pre-slice-gate PASSED                               ║\n'
	@printf '  ║  ADR-ACT-0008 first slice may now begin (Tier 1).    ║\n'
	@printf '  ║  E2E substrate: PASSED                               ║\n'
	@printf '  ║  Real Keycloak login blocked until ADR-ACT-0110.     ║\n'
	@printf '  ╚══════════════════════════════════════════════════════╝\n'
	@printf '$(RESET)'

## e2e-check — Run Playwright E2E substrate tests (Tier 1 gate — requires services running)
e2e-check:
	$(call STEP,e2e:check)
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	npm run test:e2e
	$(call OK,E2E substrate tests passed)

## e2e-local — Tier 3: Playwright E2E against local dev server (fixture session)
## Starts platform-api + Vite dev server automatically via webServer config.
## Uses LOCAL_FIXTURE_SESSION=tenant-admin for deterministic actor state.
e2e-local:
	$(call STEP,e2e:local \(dev-server fixture session\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	LOCAL_FIXTURE_SESSION=tenant-admin npm run test:e2e
	$(call OK,local E2E passed)

## e2e-build-prod — Tier 4: Build React SPA then run E2E against production build
## Proves prod build artefacts match dev behaviour (no CSS import regressions etc).
e2e-build-prod:
	$(call STEP,e2e:build-prod \(production build E2E\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	LOCAL_FIXTURE_SESSION=tenant-admin npm run test:e2e:prod
	$(call OK,production build E2E passed)

## e2e-web-smoke — Tier 5: Smoke tests against web profile (Caddy + platform-api)
## Requires: compose-up-web already running, 127.0.0.1 aldous.info in /etc/hosts.
## Uses fixture session (LOCAL_FIXTURE_SESSION=tenant-admin in compose).
e2e-web-smoke:
	$(call STEP,e2e:web-smoke \(aldous.info smoke via Caddy\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@if ! curl -fsS --max-time 5 http://aldous.info/healthz > /dev/null 2>&1; then \
		printf '$(RED)✗ aldous.info not reachable. Check:\n'; \
		printf '  1. make compose-up-web is running\n'; \
		printf '  2. /etc/hosts has: 127.0.0.1 aldous.info\n$(RESET)'; \
		exit 1; \
	fi
	@printf '$(YELLOW)ℹ Running smoke with fixture session (LOCAL_FIXTURE_SESSION=tenant-admin in compose)$(RESET)\n'
	ALDOUS_BASE_URL=http://aldous.info npx playwright test --config playwright.aldous.config.ts
	$(call OK,web smoke tests passed)

## e2e-real-auth — Tier 6: Real Keycloak browser login E2E (gracefully skipped if not provisioned)
## Requires: Keycloak running + provisioned + KEYCLOAK_TEST_USERNAME/PASSWORD set.
## Skips with a warning rather than failing make all if Keycloak is unavailable.
e2e-real-auth:
	$(call STEP,e2e:real-auth \(Keycloak browser login\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@if [ -z "$(KEYCLOAK_TEST_PASSWORD)" ]; then \
		$(call WARN,real-auth E2E skipped — KEYCLOAK_TEST_PASSWORD not set); \
		$(call WARN,Set it in .env or run: make keycloak-provision first); \
		exit 0; \
	fi
	@if ! curl -fsS --max-time 5 "http://localhost:$${KEYCLOAK_PORT:-8090}/health/ready" > /dev/null 2>&1; then \
		$(call WARN,real-auth E2E skipped — Keycloak not reachable on port $${KEYCLOAK_PORT:-8090}); \
		$(call WARN,Run: make compose-up-identity and make keycloak-provision); \
		exit 0; \
	fi
	npx playwright test --config playwright.real-auth.config.ts
	$(call OK,real-auth E2E passed)

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
	@printf '$(YELLOW)⚠ Sonar not run — this check is NOT sufficient to begin ADR-ACT-0008.\n'
	@printf '  Run: SONAR_TOKEN=<token> make pre-slice-gate$(RESET)\n'
