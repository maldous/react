.PHONY: compose-up compose-up-default compose-up-identity \
        compose-up-cloud compose-up-external-mocks compose-up-identity-mocks \
        compose-up-web compose-up-observability \
        compose-down compose-down-web compose-down-volumes compose-down-reset \
        compose-ps compose-logs \
        external-caddy-up external-caddy-down \
        sentry-up sentry-down sonar-up sonar-down identity-mocks-down \
        dev-up dev-down test-up staging-up prod-up test-down staging-down prod-down \
        reset-local seed-demo db-migrate db-shell redis-flush-local \
        keycloak-provision seed-idps

# ── Compose up ───────────────────────────────────────────────────────────────

## compose-up — Start default services for ENV
compose-up:
	bash scripts/compose/up.sh $(ENV) default

## compose-up-default — Start exactly the 6 default services (idempotent)
## Accepts ENV=test|staging|prod
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

## compose-up-identity — Start Keycloak (identity profile)
compose-up-identity:
	$(call STEP,compose: starting Keycloak ($(ENV)))
	bash scripts/compose/up.sh $(ENV) identity
	$(call OK,Keycloak ready for $(ENV))

## compose-up-cloud — Start LocalStack (cloud-mocks profile)
compose-up-cloud:
	bash scripts/compose/up.sh $(ENV) cloud

## compose-up-external-mocks — Start WireMock (external-mocks profile)
compose-up-external-mocks:
	bash scripts/compose/up.sh $(ENV) external-mocks

## compose-up-identity-mocks — Start mock-oidc upstream IdP fixture (identity-mocks profile)
## Pair with `make compose-up-identity` (Keycloak) and `make seed-idps`. Dev/test only;
## in staging/prod requires AUTH_PROVIDER_MODE=mock + the explicit bootstrap override.
compose-up-identity-mocks:
	$(call STEP,compose: starting mock-oidc ($(ENV)))
	bash scripts/compose/up.sh $(ENV) identity-mocks
	$(call OK,mock-oidc ready for $(ENV) — run `make seed-idps` to register broker IdPs)

## seed-idps — Register mock broker IdPs (mock-google/azure/apple) on the ENV realm.
## Idempotent. Requires Keycloak (compose-up-identity) + mock-oidc (compose-up-identity-mocks).
## Sources .env.$(ENV) (realm, admin creds, AUTH_PROVIDER_MODE, MOCK_OIDC_*) and targets the
## host-published Keycloak port so it works for test/staging/prod, not just dev.
seed-idps:
	$(call STEP,seed:idps ($(ENV)))
	set -a; if [ -f .env.$(ENV) ]; then . ./.env.$(ENV); fi; set +a; \
	KEYCLOAK_URL="http://localhost:$${KEYCLOAK_PORT:-8090}/kc" npm run seed:idps
	$(call OK,mock broker IdPs registered on the $(ENV) realm)

## compose-up-web — Build and start the web profile for ENV (test/staging/prod only)
## dev does not use compose web — it uses Tilt. This target hard-fails for ENV=dev.
compose-up-web:
	@if [ "$(ENV)" = "dev" ]; then \
		printf '$(RED)✗ dev does not use compose web. Use `make dev-up`.$(RESET)\n'; \
		exit 1; \
	fi
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

## compose-down-reset — Stop services and reset app data (preserves Keycloak volume by default)
## PRESERVE_JVM_VOLUMES=true (default): preserves the Keycloak volume in this env.
## PRESERVE_JVM_VOLUMES=false: destroys ALL volumes (same as compose-down-volumes).
## SonarQube lives in the react-sonar shared project — unaffected by this target.
compose-down-reset:
	$(call STEP,compose-down-reset: resetting app data ($(ENV)))
	@if [ "$(PRESERVE_JVM_VOLUMES)" = "true" ]; then \
		$(COMPOSE_CMD) down --timeout 30 2>/dev/null || true; \
		_jvm_vols="$$(docker volume ls -q --filter label=com.docker.compose.project=react-$(ENV) 2>/dev/null \
		    | grep -vE 'keycloak' || true)"; \
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

## external-caddy-down — Stop external Caddy (react-shared project)
external-caddy-down:
	PROJECT=react-shared docker/compose-wrapper.sh dev --profile external-web down --timeout 30

## sentry-up — Start shared Sentry instance (external-sentry profile, react-shared project)
## Idempotent — fast no-op when already healthy.
sentry-up:
	$(call STEP,sentry: startup)
	docker network create sentry-bridge 2>/dev/null || true
	bash scripts/compose/up.sh sentry external-sentry
	@bash scripts/smoke/sentry-smoke.sh
	$(call OK,sentry up)

## sentry-down — Stop shared Sentry instance (react-shared project)
sentry-down:
	$(call STEP,sentry: stopping)
	PROJECT=react-shared docker/compose-wrapper.sh sentry --profile external-sentry down --timeout 60
	$(call OK,sentry down)
	@$(call CONFIRM_DOWN,react-shared)

## identity-mocks-down — Stop the shared mock-oidc fixture (react-shared project)
identity-mocks-down:
	$(call STEP,mock-oidc: stopping)
	PROJECT=react-shared docker/compose-wrapper.sh dev --profile identity-mocks down --timeout 30
	$(call OK,mock-oidc down)

## sonar-up — Start shared SonarQube instance (external-sonar profile, react-sonar project)
## Idempotent — fast no-op when already healthy. Single instance shared across all envs.
sonar-up:
	$(call STEP,sonar: startup)
	bash scripts/compose/up.sh sonar external-sonar
	@_url=$$(grep -oP 'SONAR_HOST_URL=\K\S+' .env.sonar 2>/dev/null | head -1 || echo http://localhost:9064/sonar); \
	printf '$(GREEN)✓ SonarQube up at %s (project: maldous-react)$(RESET)\n' "$$_url"

## sonar-provision — Ensure a valid SonarQube analysis token exists (idempotent)
## Auto-generates a token from scratch when the shared instance is fresh.
## Requires admin/admin credentials on first run; set SONAR_ADMIN_PASSWORD in
## .env.sonar if the default password has been changed.
sonar-provision:
	bash scripts/sonar/provision-token.sh

## sonar-down — Stop shared SonarQube instance
sonar-down:
	$(call STEP,sonar: stopping)
	docker/compose-wrapper.sh sonar --profile external-sonar down --timeout 60
	$(call OK,sonar down)
	@$(call CONFIRM_DOWN,react-sonar)

# ── Environment-specific stacks ──────────────────────────────────────────────

## dev-up — Start the dev environment using Tilt only.
## dev is the only Tilt-backed environment. test, staging and prod use Compose.
dev-up:
	$(call STEP,tilt:up)
	bash scripts/tilt/up-dev.sh
	$(call OK,Tilt dev stack ready)

## test-up — Full test stack: all profiles. Sonar is shared (sonar-up) — not part of per-env stacks.
test-up:
	$(call STEP,test: full stack)
	$(MAKE) compose-up-default ENV=test
	$(MAKE) compose-up-identity ENV=test
	$(MAKE) keycloak-provision ENV=test
	$(MAKE) compose-up-external-mocks ENV=test
	$(MAKE) compose-up-observability ENV=test
	$(MAKE) compose-up-web ENV=test

## staging-up — Full staging stack: all profiles. Sonar is shared (sonar-up) — not part of per-env stacks.
staging-up:
	$(call STEP,staging: full stack)
	$(MAKE) compose-up-default ENV=staging
	$(MAKE) compose-up-identity ENV=staging
	$(MAKE) keycloak-provision ENV=staging
	$(MAKE) compose-up-external-mocks ENV=staging
	$(MAKE) compose-up-observability ENV=staging
	$(MAKE) compose-up-web ENV=staging

## prod-up — Full production-like stack: all profiles. Sonar is shared (sonar-up) — not part of per-env stacks.
prod-up:
	$(call STEP,prod: full stack)
	$(MAKE) compose-up-default ENV=prod
	$(MAKE) compose-up-identity ENV=prod
	$(MAKE) keycloak-provision ENV=prod
	$(MAKE) compose-up-external-mocks ENV=prod
	$(MAKE) compose-up-observability ENV=prod
	$(MAKE) compose-up-web ENV=prod

## dev-down — Stop dev environment
dev-down:
	$(call STEP,tilt:down)
	bash scripts/tilt/down-dev.sh
	$(call OK,Tilt stopped)

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
