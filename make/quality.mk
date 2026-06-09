.PHONY: test test-compose audit security compose architecture \
        sonar advisory sbom license \
        quality check ci full

## test — Run all tests with V8 LCOV coverage
test:
	$(call STEP,test)
	npm run test:coverage
	$(call OK,tests passed — coverage/lcov.info generated)

## test-compose — Compose service smoke tests (starts services if needed)
test-compose:
	$(call STEP,test:compose ($(ENV)))
	@$(COMPOSE_CMD) ps postgres 2>/dev/null | grep -q "healthy" \
		|| (printf '$(YELLOW)$(ENV) services not running — starting them...$(RESET)\n' \
		    && $(MAKE) compose-up-default ENV=$(ENV))
	npm run test:compose
	$(call OK,compose smoke tests passed ($(ENV)))

## audit — npm audit (high/critical) + OSV vulnerability scanner
audit:
	$(call STEP,audit)
	npm run audit:deps
	npm run audit:osv
	$(call OK,no vulnerabilities)

## security — Secret scan via gitleaks
security:
	$(call STEP,security \(gitleaks\))
	npm run secrets:scan
	$(call OK,no secrets detected)

## compose — Validate compose.yaml syntax (no services started)
compose:
	$(call STEP,compose:config)
	npm run compose:config
	npm run compose:config:all
	$(call OK,all compose profiles valid)

## architecture — Full architecture governance suite (--strict)
architecture:
	$(call STEP,architecture governance)
	$(ORCHESTRATOR) all --no-reports --strict
	$(call OK,all architecture gates passed)

## sonar — SonarQube scan + quality gate against the shared instance
## Auto-provisions a valid SONAR_TOKEN on first run (or after DB reset).
## Single shared SonarQube (react-sonar project, profile external-sonar). Single project key.
sonar:
	$(call STEP,sonar)
	@$(MAKE) sonar-provision
	@$(MAKE) sonar-up
	@# Ensure the ADR-0016 "Governance Tooling" gate exists and is assigned
	@# (idempotent; restores it after a fresh sonar-postgres volume, which would
	@# otherwise leave the project on the built-in coverage-enforcing "Sonar way").
	@bash scripts/sonar/ensure-quality-gate.sh
	@set -a; . ./.env.sonar; set +a; \
	_sonar_url="$${SONAR_HOST_URL:-http://localhost:9064/sonar}"; \
	_sonar_key="$${SONAR_PROJECT_KEY:-maldous-react}"; \
	_sonar_login="$${SONAR_TOKEN:-}"; \
	npm run test:coverage && \
	npm run coverage:normalize && \
	SONAR_HOST_URL="$$_sonar_url" SONAR_TOKEN= sonar-scanner \
		-Dsonar.projectKey="$$_sonar_key" \
		-Dsonar.projectName="maldous-react" \
		-Dsonar.host.url="$$_sonar_url" \
		-Dsonar.login="$$_sonar_login" && \
	SONAR_HOST_URL="$$_sonar_url" SONAR_TOKEN="$$_sonar_login" SONAR_PROJECT_KEY="$$_sonar_key" \
		node tools/quality/sonar-quality-gate.mjs \
		|| { printf '$(RED)✗ Sonar quality gate failed$(RESET)\n'; exit 1; }; \
	printf '$(GREEN)✓ Sonar quality gate passed$(RESET)\n'

## advisory — Report-only gates (never fail make all)
advisory:
	$(call STEP,advisory \(report-only — never fails\))
	-npm run knip
	-npm run depcruise
	$(call OK,advisory complete)

## sbom — Generate CycloneDX 1.6 SBOM
sbom:
	$(call STEP,sbom)
	npm run sbom:generate
	$(call OK,SBOM generated)

## license — Show license policy status
license:
	$(call STEP,license policy)
	npm run license:policy
	$(call OK,license policy noted)

# ── Composite quality targets ────────────────────────────────────────────────

## quality — Full quality gate (used by make all)
quality: install format lint typecheck audit security compose architecture license
	$(call OK,quality gate passed)

## check — Fast local check: format/lint/typecheck/audit/compose/architecture
check: format lint typecheck audit compose architecture
	$(call OK,check complete)

## ci — CI-safe subset
ci: install format lint typecheck test audit security compose architecture
	$(call OK,ci complete)

## full — Alias for all
full: all
	$(call OK,full run complete)
