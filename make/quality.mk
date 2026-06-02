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

## sonar — SonarQube scan + quality gate (requires SONAR_TOKEN)
sonar:
	$(call STEP,sonar)
	@if [ -z "$$SONAR_TOKEN" ]; then \
		printf '$(YELLOW)⚠ SONAR_TOKEN not set — skipping Sonar scan.\n'; \
		printf '  Set SONAR_TOKEN in .env or environment to enable.\n$(RESET)'; \
	else \
		$(COMPOSE_CMD) --profile quality up -d --wait --wait-timeout 420 sonarqube 2>/dev/null \
			|| docker compose --profile quality up -d --wait --wait-timeout 420 sonarqube \
			|| { printf '$(RED)✗ SonarQube did not become healthy$(RESET)\n'; exit 1; }; \
		printf '$(GREEN)SonarQube is UP.$(RESET)\n'; \
		npm run sonar:clean \
			|| { printf '$(RED)✗ Sonar quality gate failed$(RESET)\n'; exit 1; }; \
		printf '$(GREEN)✓ Sonar quality gate passed$(RESET)\n'; \
	fi

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
