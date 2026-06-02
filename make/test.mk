.PHONY: run-stage-tests e2e-internal e2e-internal-build test-real-auth

## run-stage-tests — Run the standard test suite against the active environment
## Requires: postgres + platform-api to be reachable.
## Accepts environment overrides: POSTGRES_URL, REDIS_URL.
run-stage-tests:
	$(call STEP,run-stage-tests ($(ENV)))
	@$(call CONN_URLS,.env.$(ENV)); \
	POSTGRES_URL="$(or $(POSTGRES_URL),$$_pg_url)" \
	REDIS_URL="$(or $(REDIS_URL),$$_rd_url)" \
	npm run test:platform-api
	npm run test:frontend:run
	$(call OK,stage tests passed for $(ENV))

## e2e-internal — Internal E2E: fixture session against localhost (Vite dev server)
## playwright.internal.config.ts starts platform-api + Vite dev server automatically.
## Accepts POSTGRES_URL and REDIS_URL overrides (e.g. from stage-test).
e2e-internal:
	$(call STEP,e2e:internal \(localhost fixture session\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@$(call CONN_URLS,.env.$(ENV)); \
	POSTGRES_URL="$(or $(POSTGRES_URL),$$_pg_url)" \
	REDIS_URL="$(or $(REDIS_URL),$$_rd_url)" \
	LOCAL_FIXTURE_SESSION=tenant-admin npx playwright test --config playwright.internal.config.ts
	$(call OK,internal E2E passed)

## e2e-internal-build — Internal build E2E: fixture session against production bundle
## playwright.build.config.ts builds the SPA then serves it with vite preview.
e2e-internal-build:
	$(call STEP,e2e:internal-build \(production bundle E2E\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	LOCAL_FIXTURE_SESSION=tenant-admin npx playwright test --config playwright.build.config.ts
	$(call OK,internal build E2E passed)

## test-real-auth — Real Keycloak auth E2E. Fails fast if prerequisites missing.
## Requires: KEYCLOAK_TEST_USERNAME, KEYCLOAK_TEST_PASSWORD, KEYCLOAK_CLIENT_SECRET,
##           aldous.info resolving to the stack, /healthz reachable.
test-real-auth:
	$(call STEP,test-real-auth: checking prerequisites)
	@if [ -z "$${KEYCLOAK_TEST_USERNAME}" ]; then \
		printf '$(RED)✗ KEYCLOAK_TEST_USERNAME is not set\n'; \
		printf '  Export it before running: export KEYCLOAK_TEST_USERNAME=sysadmin@aldous.info$(RESET)\n'; \
		exit 1; \
	fi
	@if [ -z "$${KEYCLOAK_TEST_PASSWORD}" ]; then \
		printf '$(RED)✗ KEYCLOAK_TEST_PASSWORD is not set\n'; \
		printf '  Export it before running: export KEYCLOAK_TEST_PASSWORD=password$(RESET)\n'; \
		exit 1; \
	fi
	@if [ -z "$${KEYCLOAK_CLIENT_SECRET}" ]; then \
		printf '$(RED)✗ KEYCLOAK_CLIENT_SECRET is not set\n'; \
		printf '  Must match bff_client_secret in dev.tfvars$(RESET)\n'; \
		exit 1; \
	fi
	@_base=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$${_base}/healthz" > /dev/null 2>&1; then \
		printf '$(RED)✗ /healthz unavailable at %s\n'; \
		printf '  Run: make compose-up-web && make external-caddy-up$(RESET)\n' "$${_base}"; \
		exit 1; \
	fi
	$(call OK,prerequisites satisfied)
	PROD_BASE_URL=$${PROD_BASE_URL:-http://aldous.info} \
	npx playwright test --config playwright.external.config.ts \
	    e2e/external/login.spec.ts \
	    e2e/external/logout.spec.ts \
	    e2e/external/caddy-links.spec.ts \
	    e2e/external/auth-negative.spec.ts
	$(call OK,real-auth tests passed)
