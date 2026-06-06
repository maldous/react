.PHONY: compose-up compose-up-default compose-up-quality compose-up-identity \
        compose-up-cloud compose-up-sentry compose-up-external-mocks \
        compose-up-web compose-up-observability \
        compose-down compose-down-web compose-down-volumes compose-down-reset \
        compose-ps compose-logs \
        external-caddy-up external-caddy-down \
        sentry-up sentry-down \
        dev-up dev-up-minimal test-up staging-up prod-up \
        dev-down test-down staging-down prod-down \
        reset-local seed-demo db-migrate db-shell redis-flush-local \
        keycloak-provision

# ── Compose up ───────────────────────────────────────────────────────────────

## compose-up — Start default services for ENV
compose-up:
	bash scripts/compose/up.sh $(ENV) default

## compose-up-default — Start exactly the 6 default services (idempotent)
## Accepts ENV=dev|test|staging|prod (default: dev)
compose-up-default:
	$(call STEP,compose:up:default ($(ENV)))
	bash scripts/compose/up.sh $(ENV) default
	$(call OK,default services healthy for $(ENV))

## compose-up-observability — Start Loki + Grafana + Alloy (observability profile)
## Grafana UI: http://localhost:${GRAFANA_PORT:-3200}
compose-up-observability:
	$(call STEP,compose: starting Loki + Grafana + Alloy ($(ENV)))
	bash scripts/compose/up.sh $(ENV) observability
	$(call OK,Observability stack ready for $(ENV))

## compose-up-quality — Start SonarQube (quality profile)
compose-up-quality:
	$(call STEP,compose: starting SonarQube ($(ENV)))
	bash scripts/compose/up.sh $(ENV) quality
	$(call OK,SonarQube ready for $(ENV))

## compose-up-identity — Start Keycloak (identity profile)
compose-up-identity:
	$(call STEP,compose: starting Keycloak ($(ENV)))
	bash scripts/compose/up.sh $(ENV) identity
	$(call OK,Keycloak ready for $(ENV))

## compose-up-cloud — Start LocalStack (cloud-mocks profile)
compose-up-cloud:
	bash scripts/compose/up.sh $(ENV) cloud

## compose-up-sentry — Start shared Sentry (delegates to sentry-up; ENV ignored)
compose-up-sentry:
	$(MAKE) sentry-up

## compose-up-external-mocks — Start WireMock (external-mocks profile)
compose-up-external-mocks:
	bash scripts/compose/up.sh $(ENV) external-mocks

## compose-up-web — Build and start the web profile for ENV
compose-up-web:
	$(call STEP,web:up ($(ENV)))
	bash scripts/compose/up.sh $(ENV) web
	@_port=$$(grep '^WEB_HTTP_PORT=' .env.$(ENV) 2>/dev/null | head -1 | cut -d= -f2 || echo "80"); \
	_apex=$$(grep '^APEX_DOMAIN=' .env.$(ENV) 2>/dev/null | head -1 | cut -d= -f2 || echo "localhost"); \
	printf '$(GREEN)✓ Web profile for $(ENV) started → http://%s:%s$(RESET)\n' "$${_apex}" "$${_port}"

# ── Compose down ─────────────────────────────────────────────────────────────

## compose-down — Stop all running compose services for ENV
compose-down:
	bash scripts/compose/down.sh $(ENV)
	@$(call CONFIRM_DOWN,react-$(ENV))

## compose-down-web — Stop web profile containers for ENV
compose-down-web:
	$(COMPOSE_CMD) --profile web down --timeout 30
	@$(call CONFIRM_DOWN,react-$(ENV))

## compose-down-volumes — Stop services and remove ALL named volumes for ENV
compose-down-volumes:
	bash scripts/compose/down.sh $(ENV) --volumes

## compose-down-reset — Stop services and reset app data (preserves JVM volumes by default)
## PRESERVE_JVM_VOLUMES=true (default): preserves Keycloak and SonarQube volumes.
## PRESERVE_JVM_VOLUMES=false: destroys ALL volumes (same as compose-down-volumes).
compose-down-reset:
	$(call STEP,compose-down-reset: resetting app data ($(ENV)))
	@if [ "$(PRESERVE_JVM_VOLUMES)" = "true" ]; then \
		$(COMPOSE_CMD) down --timeout 30 2>/dev/null || true; \
		_jvm_vols="$$(docker volume ls -q --filter label=com.docker.compose.project=react-$(ENV) 2>/dev/null \
		    | grep -vE 'keycloak|sonar' || true)"; \
		[ -n "$$_jvm_vols" ] && echo "$$_jvm_vols" | xargs docker volume rm 2>/dev/null || true; \
	else \
		bash scripts/compose/down.sh $(ENV) --volumes; \
	fi
	@$(call CONFIRM_DOWN,react-$(ENV))
	$(call OK,app data reset for $(ENV))

## compose-ps — Show compose service status for ENV
compose-ps:
	$(COMPOSE_CMD) ps

## compose-logs — Follow compose logs for ENV (Ctrl-C to exit)
compose-logs:
	$(COMPOSE_CMD) logs --follow --tail=100

# ── External Caddy ───────────────────────────────────────────────────────────

## external-caddy-up — Start external Caddy on host port 80 (Cloudflare-facing)
## Routes staging.aldous.info → localhost:82, aldous.info → localhost:83.
## Always uses the react-dev project (network_mode: host requires it).
external-caddy-up:
	$(call STEP,external-caddy: startup)
	bash scripts/compose/up.sh dev external-web
	$(call OK,external Caddy ready on port 80 — Cloudflare origin is live)

## external-caddy-down — Stop external Caddy
external-caddy-down:
	docker compose --profile external-web down --timeout 30

## sentry-up — Start shared Sentry instance (external-sentry profile, react-sentry project)
## Idempotent — fast no-op when already healthy.
sentry-up:
	$(call STEP,sentry: startup)
	bash scripts/compose/up.sh sentry external-sentry
	$(call OK,sentry up)

## sentry-down — Stop shared Sentry instance
sentry-down:
	$(call STEP,sentry: stopping)
	docker/compose-wrapper.sh sentry --profile external-sentry down --timeout 60
	$(call OK,sentry down)
	@$(call CONFIRM_DOWN,react)
	$(call OK,external Caddy stopped)

# ── Environment-specific stacks ──────────────────────────────────────────────

## dev-up — Full dev stack: all profiles (Compose-based; for Tilt dev use tilt-up then env-up-all)
dev-up:
	$(call STEP,dev: full stack)
	$(MAKE) compose-up-default ENV=dev
	$(MAKE) compose-up-identity ENV=dev
	$(MAKE) keycloak-provision ENV=dev
	$(MAKE) compose-up-quality ENV=dev
	$(MAKE) compose-up-external-mocks ENV=dev
	$(MAKE) compose-up-observability ENV=dev
	$(MAKE) compose-up-web ENV=dev

## dev-up-minimal — Start only default infra for dev (no web, no Keycloak)
dev-up-minimal:
	$(call STEP,dev: up minimal)
	$(MAKE) compose-up-default ENV=dev

## test-up — Full test stack: all profiles
test-up:
	$(call STEP,test: full stack)
	$(MAKE) compose-up-default ENV=test
	$(MAKE) compose-up-identity ENV=test
	$(MAKE) keycloak-provision ENV=test
	$(MAKE) compose-up-quality ENV=test
	$(MAKE) compose-up-external-mocks ENV=test
	$(MAKE) compose-up-observability ENV=test
	$(MAKE) compose-up-web ENV=test

## staging-up — Full staging stack: all profiles
staging-up:
	$(call STEP,staging: full stack)
	$(MAKE) compose-up-default ENV=staging
	$(MAKE) compose-up-identity ENV=staging
	$(MAKE) keycloak-provision ENV=staging
	$(MAKE) compose-up-quality ENV=staging
	$(MAKE) compose-up-external-mocks ENV=staging
	$(MAKE) compose-up-observability ENV=staging
	$(MAKE) compose-up-web ENV=staging

## prod-up — Full production-like stack: all profiles
prod-up:
	$(call STEP,prod: full stack)
	$(MAKE) compose-up-default ENV=prod
	$(MAKE) compose-up-identity ENV=prod
	$(MAKE) keycloak-provision ENV=prod
	$(MAKE) compose-up-quality ENV=prod
	$(MAKE) compose-up-external-mocks ENV=prod
	$(MAKE) compose-up-observability ENV=prod
	$(MAKE) compose-up-web ENV=prod

## dev-down — Stop dev stack
dev-down:
	$(MAKE) compose-down ENV=dev

## test-down — Stop test stack
test-down:
	$(MAKE) compose-down ENV=test

## staging-down — Stop staging stack
staging-down:
	$(MAKE) compose-down ENV=staging

## prod-down — Stop production stack
prod-down:
	$(MAKE) compose-down ENV=prod

# ── Database / Redis ─────────────────────────────────────────────────────────

## reset-local — Reset local Postgres to clean migrated+seeded state (destructive)
reset-local:
	$(call STEP,reset:local)
	@printf '$(BOLD)$(RED)Resetting local database — drops all tables, re-migrates, re-seeds$(RESET)\n'
	npm run db:reset
	npm run db:migrate
	npm run db:seed
	$(call OK,local database reset complete)

## seed-demo — Seed fixture data into local Postgres (idempotent)
seed-demo:
	$(call STEP,seed:demo)
	npm run db:seed
	$(call OK,fixture data seeded)

## db-migrate — Run database migrations (idempotent)
db-migrate:
	$(call STEP,db:migrate)
	npm run db:migrate
	$(call OK,migrations complete)

## db-shell — Open a psql shell to ENV's Compose Postgres
db-shell:
	$(call STEP,db:shell ($(ENV)))
	$(COMPOSE_CMD) exec postgres psql -U $${POSTGRES_USER:-platform} -d $${POSTGRES_DB:-platform}

## redis-flush-local — Flush all keys from ENV's Compose Redis
redis-flush-local:
	$(call STEP,redis:flush:local ($(ENV)))
	@printf '$(BOLD)$(RED)Flushing Redis ($(ENV)) — all sessions will be cleared$(RESET)\n'
	$(COMPOSE_CMD) exec redis redis-cli FLUSHALL
	$(call OK,Redis flushed for $(ENV))

# ── Keycloak provisioning ────────────────────────────────────────────────────

## keycloak-provision — Apply Terraform to provision the platform Keycloak realm
## Scoped to ENV: each environment uses infra/env/$(ENV)/$(ENV).tfvars.
keycloak-provision:
	$(call STEP,keycloak: provisioning realm via Terraform ($(ENV)))
	@_tfdir=infra/env/$(ENV); \
	if [ ! -f "$${_tfdir}/$(ENV).tfvars" ]; then \
		printf "$(RED)✗ Terraform vars not found in $${_tfdir}.\n"; \
		printf "  Copy $(ENV).tfvars.example to $(ENV).tfvars and fill in values.$(RESET)\n"; \
		exit 1; \
	fi; \
	cd $${_tfdir} && terraform init -upgrade -input=false > /dev/null 2>&1 \
	    && terraform apply -var-file=$(ENV).tfvars -auto-approve -input=false
	$(call OK,Keycloak realm provisioned for $(ENV))
