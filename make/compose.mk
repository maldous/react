.PHONY: compose-up compose-up-default compose-up-identity \
        compose-up-cloud compose-up-external-mocks compose-up-identity-mocks \
        compose-up-secrets compose-up-search-provider compose-up-observability-provider \
        compose-up-web compose-up-observability \
        compose-down compose-down-web compose-down-volumes compose-down-reset \
        compose-ps compose-logs \
        external-caddy-up external-caddy-down \
        sentry-up sentry-down sonar-up sonar-down identity-mocks-down \
        dev-up dev-down test-up staging-up prod-up test-down staging-down prod-down \
        reset-local seed-demo db-migrate db-backup db-restore db-shell redis-flush-local \
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

## compose-up-observability — Start Loki + Tempo + Grafana + Alloy (observability profile)
## Grafana UI: http://localhost:${GRAFANA_PORT:-3200}. Tempo (traces) is part of the normal
## stack so E2E trace-by-id correlation works at every stage (ADR-ACT-0285 closure / ADR-ACT-0284).
compose-up-observability:
	$(call STEP,compose: starting Loki + Tempo + Grafana + Alloy ($(ENV)))
	bash scripts/compose/up.sh $(ENV) observability
	$(call OK,Observability stack ready for $(ENV))

## compose-up-identity — Start Keycloak (identity profile)
compose-up-identity:
	$(call STEP,compose: starting Keycloak ($(ENV)))
	bash scripts/compose/up.sh $(ENV) identity
	$(call OK,Keycloak ready for $(ENV))

## compose-up-secrets — Start OpenBao central secrets manager (secrets profile, dev mode)
## Pair with SECRET_STORE_PROVIDER=openbao to route the SecretStorePort at OpenBao.
compose-up-secrets:
	$(call STEP,compose: starting OpenBao ($(ENV)))
	bash scripts/compose/up.sh $(ENV) secrets
	$(call OK,OpenBao ready for $(ENV) — run `npm run proof:secrets-openbao`)

## compose-up-search-provider — Start Meilisearch composed search provider (ADR-0071)
## Postgres FTS stays the default backend; this proves the composed provider readiness.
compose-up-search-provider:
	$(call STEP,compose: starting Meilisearch ($(ENV)))
	bash scripts/compose/up.sh $(ENV) search-provider
	$(call OK,Meilisearch ready for $(ENV) — run `npm run proof:composed-provider-readiness`)

## compose-up-observability-provider — Start Prometheus + Tempo + Alertmanager (ADR-0071)
compose-up-observability-provider:
	$(call STEP,compose: starting Prometheus + Tempo + Alertmanager ($(ENV)))
	bash scripts/compose/up.sh $(ENV) observability-provider
	$(call OK,Observability providers ready for $(ENV) — run `npm run proof:composed-provider-readiness`)

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
## Sources $(ENV_FILE) (realm, admin creds, AUTH_PROVIDER_MODE, MOCK_OIDC_*) and targets the
## host-published Keycloak port so it works for test/staging/prod, not just dev.
seed-idps:
	$(call STEP,seed:idps ($(ENV)))
	set -a; if [ -f $(ENV_FILE) ]; then . $(ENV_FILE); fi; set +a; \
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
	@_port=$$(grep '^WEB_HTTP_PORT=' $(ENV_FILE) 2>/dev/null | head -1 | cut -d= -f2 || echo "80"); \
	_apex=$$(grep '^APEX_DOMAIN=' $(ENV_FILE) 2>/dev/null | head -1 | cut -d= -f2 || echo "localhost"); \
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
	bash scripts/sentry/ensure-relay-credentials.sh
	bash scripts/compose/up.sh sentry external-sentry
	@bash scripts/smoke/sentry-smoke.sh
	bash scripts/sentry/provision-sentry.sh
	$(call OK,sentry up)

## sentry-down — Stop shared Sentry instance (react-shared project)
sentry-down:
	$(call STEP,sentry: stopping)
	PROJECT=react-shared docker/compose-wrapper.sh sentry --profile external-sentry down --timeout 60
	$(call OK,sentry down)
	@$(call CONFIRM_DOWN,react-shared)

## identity-mocks-down — Stop this env's mock-oidc fixture (react-$(ENV) project)
## Removes ONLY the mock-oidc service (rm -sf), never `down` — `down` would tear
## down the whole react-$(ENV) project (Keycloak, postgres, …), not just the fixture.
identity-mocks-down:
	$(call STEP,mock-oidc: stopping ($(ENV)))
	docker/compose-wrapper.sh $(ENV) --profile identity-mocks rm -sf mock-oidc
	$(call OK,mock-oidc down for $(ENV))

## sonar-up — Start shared SonarQube instance (external-sonar profile, react-sonar project)
## Idempotent — fast no-op when already healthy. Single instance shared across all envs.
sonar-up:
	$(call STEP,sonar: startup)
	docker network create sonar-bridge 2>/dev/null || true
	bash scripts/compose/up.sh sonar external-sonar
	@_url=$$(grep -oP 'SONAR_HOST_URL=\K\S+' "$$(bash scripts/env/resolve-env-file.sh sonar)" 2>/dev/null | head -1 || echo http://localhost:9064/sonar); \
	printf '$(GREEN)✓ SonarQube up at %s (project: maldous-react)$(RESET)\n' "$$_url"

## sonar-provision — Ensure a valid SonarQube analysis token exists (idempotent)
## Auto-generates a token from scratch when the shared instance is fresh.
## Requires admin/admin credentials on first run; set SONAR_ADMIN_PASSWORD in
## .env.sonar if the default password has been changed.
sonar-provision:
	bash scripts/sonar/provision-token.sh
	bash scripts/sonar/provision-oidc.sh

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

## db-backup — Dump ENV's Postgres to .local-artifacts/backups (local-only; ADR-ACT-0229)
db-backup:
	$(call STEP,db:backup ($(ENV)))
	ENV=$(ENV) bash scripts/backup/postgres-backup.sh

## db-restore — GUARDED restore (ENV=dev|test + CONFIRM_RESTORE=restore-ENV). Destructive.
##   make db-restore ENV=test CONFIRM_RESTORE=restore-test BACKUP_FILE=.local-artifacts/backups/<file>
db-restore:
	$(call STEP,db:restore ($(ENV)))
	ENV=$(ENV) CONFIRM_RESTORE=$(CONFIRM_RESTORE) BACKUP_FILE=$(BACKUP_FILE) bash scripts/backup/postgres-restore.sh

## redis-flush-local — Flush all keys from ENV's Compose Redis
redis-flush-local:
	$(call STEP,redis:flush:local ($(ENV)))
	@printf '$(BOLD)$(RED)Flushing Redis ($(ENV)) — all sessions will be cleared$(RESET)\n'
	$(COMPOSE_CMD) exec redis redis-cli FLUSHALL
	$(call OK,Redis flushed for $(ENV))

# ── Keycloak provisioning ────────────────────────────────────────────────────

## keycloak-provision — Apply Terraform to provision the platform Keycloak realm.
## Scoped to ENV. NON-SECRET config comes from infra/env/$(ENV)/$(ENV).tfvars (or the
## tracked secret-free *.example fallback). SECRETS are sourced from $(ENV_FILE) (the
## gitignored secret store) and exported as TF_VAR_* — never read from committed tfvars
## (ADR-0023/ADR-0044, constraint #8). Terraform auto-reads TF_VAR_<name> for each var.
keycloak-provision:
	$(call STEP,keycloak: provisioning realm via Terraform ($(ENV)))
	@_tfdir=infra/env/$(ENV); \
	_varfile=$(ENV).tfvars; \
	if [ ! -f "$${_tfdir}/$${_varfile}" ]; then _varfile=$(ENV).tfvars.example; fi; \
	_envf=$(ENV_FILE); \
	if [ -f "$${_envf}" ]; then set -a; . "$${_envf}"; set +a; \
	else printf "$(YELLOW)! no $${_envf} — TF_VAR_* secrets must be exported in the environment$(RESET)\n"; fi; \
	export TF_VAR_keycloak_admin_user="$${KEYCLOAK_ADMIN_USER:-admin}"; \
	export TF_VAR_keycloak_admin_password="$${KEYCLOAK_ADMIN_PASSWORD:-}"; \
	export TF_VAR_bff_client_secret="$${KEYCLOAK_CLIENT_SECRET:-}"; \
	export TF_VAR_provisioner_client_secret="$${KEYCLOAK_PROVISIONER_CLIENT_SECRET:-}"; \
	export TF_VAR_fixture_user_password="$${KEYCLOAK_TEST_PASSWORD:-}"; \
	export TF_VAR_enable_composed_sso="$${COMPOSE_SSO_ENABLED:-false}"; \
	export TF_VAR_grafana_oidc_client_secret="$${GRAFANA_OIDC_CLIENT_SECRET:-}"; \
	export TF_VAR_sonar_oidc_client_secret="$${SONAR_OIDC_CLIENT_SECRET:-}"; \
	export TF_VAR_pgadmin_oidc_client_secret="$${PGADMIN_OIDC_CLIENT_SECRET:-}"; \
	cd $${_tfdir} && terraform init -upgrade -input=false > /dev/null 2>&1 \
	    && terraform apply -var-file=$${_varfile} -auto-approve -input=false
	$(call OK,Keycloak realm provisioned for $(ENV))
