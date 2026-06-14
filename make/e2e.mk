.PHONY: e2e-external-smoke e2e-external-auth e2e-external \
        dev-e2e dev-e2e-auth test-e2e staging-e2e prod-e2e run-stage-e2e \
        e2e-coverage-validate e2e-observability-correlation e2e-clickability \
        e2e-failure-rootcause e2e-accessibility e2e-persona-authz

## e2e-accessibility — axe-core WCAG 2.1 A/AA across safe routes x a11y profiles
## (default/reduced-motion/high-contrast) + structural contract (landmark/h1).
## ADR-ACT-0285 Phase 6. Writes docs/evidence/e2e/<stage>-accessibility-coverage-latest.{json,md}.
e2e-accessibility:
	$(call STEP,e2e:accessibility \($(ENV)\))
	@_url="$${PROD_BASE_URL:-}"; \
	if [ -z "$$_url" ]; then _port="$$(grep -oP 'WEB_HTTP_PORT=\K\d+' .env/$(ENV).env 2>/dev/null | head -1 || echo 80)"; _url="http://localhost:$$_port"; fi; \
	PROD_BASE_URL="$$_url" E2E_STAGE=$(ENV) npx playwright test --config playwright.discovery.config.ts e2e/discovery/accessibility.spec.ts
	$(call OK,accessibility coverage written)

## e2e-persona-authz — persona authorization permutation: forbidden routes/APIs are
## denied, expected ones allowed (E2E_PERSONA selects the persona; default
## unauthenticated-visitor). ADR-ACT-0285 Phase 6. Writes <stage>-persona-coverage-latest.
e2e-persona-authz:
	$(call STEP,e2e:persona-authz \($(ENV) / $${E2E_PERSONA:-unauthenticated-visitor}\))
	@_url="$${PROD_BASE_URL:-}"; \
	if [ -z "$$_url" ]; then _port="$$(grep -oP 'WEB_HTTP_PORT=\K\d+' .env/$(ENV).env 2>/dev/null | head -1 || echo 80)"; _url="http://localhost:$$_port"; fi; \
	PROD_BASE_URL="$$_url" E2E_STAGE=$(ENV) npx playwright test --config playwright.discovery.config.ts e2e/discovery/persona-authz.spec.ts
	$(call OK,persona authorization coverage written)

## e2e-failure-rootcause — Failure-path / root-cause + Grafana-Loki validation
## (ADR-ACT-0285 Phase 5). Triggers a denial, proves it is root-causeable in Loki
## (stable reason + requestId + traceId), and enforces the label policy (no
## high-cardinality Loki labels). Honest DEGRADED when Loki/app unreachable; FAILED
## when a failure has no root-cause log or a forbidden label exists. Writes
## docs/evidence/e2e/<stage>-{failure-rootcause,grafana-loki}-latest.{json,md}.
e2e-failure-rootcause:
	$(call STEP,e2e:failure-rootcause \($(ENV)\))
	@STAGE=$(ENV) node tools/e2e/failure-rootcause/src/index.mjs
	$(call OK,failure-path root-cause + Grafana/Loki evidence written)

## e2e-clickability — Dynamic clickability crawler (ADR-ACT-0285 Phase 4 / ADR-0075).
## Discovers visible clickable surfaces by accessible ROLE (never CSS), safely
## crawls same-origin SPA routes, and quality-gates each page (main landmark, h1,
## no console/page/asset errors, not blank) + diffs discovered routes vs the UI
## contract. Needs a running stack at PROD_BASE_URL (defaults to the stage web URL).
## Writes docs/evidence/e2e/<stage>-clickability-latest.{json,md} + trace/video on fail.
e2e-clickability:
	$(call STEP,e2e:clickability \($(ENV)\))
	@_url="$${PROD_BASE_URL:-}"; \
	if [ -z "$$_url" ]; then \
		_port="$$(grep -oP 'WEB_HTTP_PORT=\K\d+' .env/$(ENV).env 2>/dev/null | head -1 || echo 80)"; \
		_url="http://localhost:$$_port"; \
	fi; \
	PROD_BASE_URL="$$_url" E2E_STAGE=$(ENV) npx playwright test --config playwright.discovery.config.ts
	$(call OK,clickability crawl complete)

## e2e-observability-correlation — Prove each E2E scenario is findable in the logs
## (and, when delivered, Tempo) by its testRunId/scenarioId (ADR-ACT-0285 Phase 3).
## Honest: DEGRADED (exit 0) when Loki/Tempo unreachable or no E2E_TEST_RUN_ID;
## FAILED (exit 1) only when a known run produced ZERO correlatable lines. Writes
## docs/evidence/e2e/<stage>-observability-correlation-latest.{json,md}.
e2e-observability-correlation:
	$(call STEP,e2e:observability-correlation \($(ENV)\))
	@STAGE=$(ENV) node tools/e2e/observability-correlation/src/index.mjs
	$(call OK,observability correlation evidence written)

## e2e-coverage-validate — Stage-aware E2E coverage gate (ADR-0075 / ADR-ACT-0285).
## Fails make all when a delivered/locally-proven capability, admin route, nav item,
## clickthrough policy entry, role, accessibility profile, or UI surface lacks declared
## E2E coverage (minus honest exemptions). Pure registry validation — no running stack
## required, so it runs at every stage. Writes docs/evidence/e2e/<stage>-*-latest.{json,md}.
e2e-coverage-validate:
	$(call STEP,e2e:coverage-validate \($(ENV)\))
	@STAGE=$(ENV) node tools/e2e/validate-e2e/src/index.mjs all
	$(call OK,e2e coverage + persona + ui-contract registries validated)

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

## e2e-external-auth — External auth E2E against a running stack (real Keycloak).
## Requires KEYCLOAK_TEST_USERNAME + KEYCLOAK_TEST_PASSWORD. FAILS (not skips) when
## missing — the stage gate must never silently drop real auth (ADR-ACT-0285 Phase 2).
## E2E_AUTH_OPTIONAL=1 permits a graceful skip for OPTIONAL local manual runs only;
## the stage policy never sets it, so staging/prod always enforce the gate.
e2e-external-auth:
	$(call STEP,e2e:external-auth \(real Keycloak login\))
	@if [ -z "$${KEYCLOAK_TEST_USERNAME}" ] || [ -z "$${KEYCLOAK_TEST_PASSWORD}" ]; then \
		if [ "$${E2E_AUTH_OPTIONAL:-}" = "1" ]; then \
			$(call WARN,external-auth E2E skipped — E2E_AUTH_OPTIONAL=1 (manual local run only)); \
			exit 0; \
		fi; \
		printf '$(RED)✗ FAILED CONFIDENCE: external-auth requires KEYCLOAK_TEST_USERNAME + KEYCLOAK_TEST_PASSWORD$(RESET)\n'; \
		printf '$(YELLOW)  See docs/local-development/real-login-e2e.md. staging/prod cannot pass without real auth.$(RESET)\n'; \
		exit 1; \
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
	@_url="$$(grep -oP 'APP_BASE_URL=\K\S+' .env/dev.env 2>/dev/null | head -1 || true)"; \
	_url=$${_url:-http://dev.localhost:8080}; \
	PROD_BASE_URL="$$_url" npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,dev E2E passed)

## dev-e2e-auth — Run auth E2E against dev (requires Keycloak)
dev-e2e-auth:
	$(call STEP,e2e: dev auth)
	@_url="$$(grep -oP 'APP_BASE_URL=\K\S+' .env/dev.env 2>/dev/null | head -1 || true)"; \
	_url=$${_url:-http://dev.localhost:8080}; \
	_apex="$$(grep -oP 'APEX_DOMAIN=\K\S+' .env/dev.env 2>/dev/null | head -1 || true)"; \
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
## Uses WEB_HTTP_PORT derived from $(ENV_FILE).
run-stage-e2e:
	$(call STEP,run-stage-e2e ($(ENV)))
	@_port=$$(grep '^WEB_HTTP_PORT=' $(ENV_FILE) 2>/dev/null | head -1 | cut -d= -f2 || echo "80"); \
	PROD_BASE_URL="http://localhost:$${_port}" \
	npx playwright test --config playwright.external.config.ts e2e/external/smoke.test.ts
	$(call OK,stage E2E passed for $(ENV))
