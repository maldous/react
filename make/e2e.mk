.PHONY: e2e-external-smoke e2e-external-auth e2e-external \
        dev-e2e dev-e2e-auth test-e2e staging-e2e prod-e2e run-stage-e2e

## e2e-external-smoke — External smoke tests against a running stack (no auth required)
## Runs e2e/external/smoke.test.ts against PROD_BASE_URL.
e2e-external-smoke:
	$(call STEP,e2e:external-smoke \($${PROD_BASE_URL:-http://aldous.info}\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@BASE=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$$BASE/healthz" > /dev/null 2>&1; then \
		printf '$(RED)✗ $$BASE not reachable. Run: make compose-up-web$(RESET)\n'; \
		exit 1; \
	fi; \
	PROD_BASE_URL=$$BASE npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,external smoke tests passed)

## e2e-external-auth — External auth E2E against a running stack (real Keycloak)
## Requires: KEYCLOAK_TEST_PASSWORD set. Skips gracefully if prerequisites not met.
e2e-external-auth:
	$(call STEP,e2e:external-auth \(Keycloak login — gracefully skipped if not provisioned\))
	@if [ -z "$${KEYCLOAK_TEST_PASSWORD}" ]; then \
		$(call WARN,external-auth E2E skipped — KEYCLOAK_TEST_PASSWORD not set); \
		exit 0; \
	fi
	@BASE=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$$BASE/healthz" > /dev/null 2>&1; then \
		printf '$(RED)✗ $$BASE not reachable$(RESET)\n'; \
		exit 1; \
	fi; \
	PROD_BASE_URL=$$BASE npx playwright test --config playwright.external.config.ts \
	    e2e/external/login.spec.ts e2e/external/logout.spec.ts \
	    e2e/external/caddy-links.spec.ts e2e/external/auth-negative.spec.ts
	$(call OK,external auth E2E passed)

## e2e-external — Full external E2E against PROD_BASE_URL (default: http://aldous.info)
## Called standalone for real Cloudflare: PROD_BASE_URL=https://aldous.info make e2e-external
e2e-external:
	$(call STEP,e2e:external \($${PROD_BASE_URL:-http://aldous.info}\))
	@if ! npx playwright --version > /dev/null 2>&1; then \
		printf '$(RED)✗ Playwright not found. Run: npx playwright install chromium --with-deps$(RESET)\n'; \
		exit 1; \
	fi
	@BASE=$${PROD_BASE_URL:-http://aldous.info}; \
	if ! curl -fsS --max-time 10 "$$BASE/healthz" > /dev/null 2>&1; then \
		printf '$(RED)✗ $$BASE not reachable.\n'; \
		printf '  For local: ensure 127.0.0.1 aldous.info is in /etc/hosts and make compose-up-web has run.\n'; \
		printf '  For Cloudflare: ensure the site is deployed and accessible.$(RESET)\n'; \
		exit 1; \
	fi; \
	PROD_BASE_URL="$$BASE" npx playwright test --config playwright.external.config.ts
	$(call OK,external E2E passed)

## dev-e2e — Run E2E smoke tests against dev environment
dev-e2e:
	$(call STEP,e2e: dev (internal))
	@_url="$$(grep -oP 'APP_BASE_URL=\K\S+' .env.dev 2>/dev/null | head -1)"; \
	_url=$${_url:-http://dev.localhost:8080}; \
	PROD_BASE_URL="$$_url" npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,dev E2E passed)

## dev-e2e-auth — Run auth E2E against dev (requires Keycloak)
dev-e2e-auth:
	$(call STEP,e2e: dev auth)
	@_url="$$(grep -oP 'APP_BASE_URL=\K\S+' .env.dev 2>/dev/null | head -1)"; \
	_url=$${_url:-http://dev.localhost:8080}; \
	_apex="$$(grep -oP 'APEX_DOMAIN=\K\S+' .env.dev 2>/dev/null | head -1)"; \
	_apex=$${_apex:-dev.localhost}; \
	PROD_BASE_URL="$$_url" APEX_DOMAIN="$$_apex" \
	npx playwright test --config playwright.external.config.ts \
	    e2e/external/login.spec.ts e2e/external/logout.spec.ts
	$(call OK,dev auth E2E passed)

## test-e2e — Run E2E tests against test environment
test-e2e:
	$(call STEP,e2e: test (internal))
	PROD_BASE_URL=http://test.localhost \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,test E2E passed)

## staging-e2e — Run E2E tests against staging (external) environment (localhost:82)
staging-e2e:
	$(call STEP,e2e: staging (external))
	PROD_BASE_URL=http://localhost:82 \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,staging E2E passed)

## prod-e2e — Run E2E tests against prod-like (external) environment (localhost:83)
prod-e2e:
	$(call STEP,e2e: prod-like (external))
	PROD_BASE_URL=http://localhost:83 \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,prod-like E2E passed)

## run-stage-e2e — Run E2E smoke tests against the active environment
## Uses WEB_HTTP_PORT derived from .env.$(ENV).
run-stage-e2e:
	$(call STEP,run-stage-e2e ($(ENV)))
	@_port=$$(grep '^WEB_HTTP_PORT=' .env.$(ENV) 2>/dev/null | head -1 | cut -d= -f2 || echo "80"); \
	PROD_BASE_URL="http://localhost:$${_port}" \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,stage E2E passed for $(ENV))
