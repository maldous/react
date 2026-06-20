.PHONY: test test-compose audit security compose architecture semgrep \
        sonar advisory sbom sbom-verify sbom-policy license \
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

## security — Secret scan via gitleaks (fail-closed in CI/authoritative; skips locally)
security:
	$(call STEP,security \(gitleaks\))
	@if [ "$${CI:-}" = "true" ] || [ "$${AUTHORITATIVE_SCAN:-}" = "true" ]; then \
		command -v gitleaks >/dev/null 2>&1 || { printf '$(RED)✗ gitleaks not found — required in authoritative mode$(RESET)\n'; exit 1; }; \
		gitleaks detect --source . --no-git --verbose || { printf '$(RED)✗ gitleaks scan found secrets$(RESET)\n'; exit 1; }; \
	else \
		command -v gitleaks >/dev/null 2>&1 || { printf '$(YELLOW)⚠ gitleaks not found — skipping (install: https://github.com/gitleaks/gitleaks/releases)$(RESET)\n'; exit 0; }; \
		gitleaks detect --source . || { printf '$(RED)✗ gitleaks scan found secrets$(RESET)\n'; exit 1; }; \
	fi
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
	npm run codegen:check
	npm run frontend:conventions
	node tools/architecture/validate-openapi-drift/src/index.mjs --strict
	$(call OK,all architecture gates passed)

## semgrep — ERROR-severity constraint rules (tools/semgrep). Hard gate; advisory WARNING/INFO excluded.
## Enforced in CI and the dev container (semgrep is provisioned there). Locally it skips with a
## warning if semgrep is not installed, so a missing binary never blocks an ad-hoc checkout.
semgrep:
	$(call STEP,semgrep (ERROR-severity constraints))
	@command -v semgrep >/dev/null 2>&1 \
		|| { printf '$(YELLOW)⚠ semgrep not installed — skipping (install: pipx install semgrep). Enforced in CI/devcontainer.$(RESET)\n'; exit 0; }
	npm run semgrep:gate
	$(call OK,semgrep constraint gate passed)

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
	@set -a; . "$$(bash scripts/env/resolve-env-file.sh sonar)"; set +a; \
	_sonar_url="$${SONAR_HOST_URL:-http://localhost:9064/sonar}"; \
	_sonar_key="$${SONAR_PROJECT_KEY:-maldous-react}"; \
	_sonar_login="$${SONAR_TOKEN:-}"; \
	npm run test:coverage && \
	npm run coverage:normalize && \
	SONAR_HOST_URL="$$_sonar_url" SONAR_TOKEN="$$_sonar_login" sonar-scanner \
		-Dsonar.projectKey="$$_sonar_key" \
		-Dsonar.projectName="maldous-react" \
		-Dsonar.host.url="$$_sonar_url" \
		-Dsonar.token="$$_sonar_login" && \
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

## sbom — Generate CycloneDX 1.6 SBOM and record lockfile hash for semantic freshness
sbom:
	$(call STEP,sbom)
	npm run sbom:generate
	@sha256sum package-lock.json | cut -d' ' -f1 > docs/evidence/security/sbom-baseline.lockhash
	$(call OK,SBOM generated + lockfile hash recorded)

## license — Show license policy status
license:
	$(call STEP,license policy)
	npm run license:policy
	$(call OK,license policy noted)

## sbom-verify — Verify SBOM semantic freshness (SHA-256 hash vs package-lock.json)
sbom-verify:
	$(call STEP,sbom:verify)
	npm run sbom:verify
	$(call OK,SBOM verified)

## sbom-policy — Check SBOM license policy (fail on GPL/AGPL/SSPL/Commons/BUSL)
sbom-policy:
	$(call STEP,sbom:policy)
	npm run sbom:policy
	$(call OK,SBOM policy passed)

# ── Composite quality targets ────────────────────────────────────────────────

## quality — Full quality gate (used by make all)
## advisory (knip/depcruise) is report-only — it runs in make all but never fails it.
quality: install format lint typecheck audit security compose architecture semgrep license sbom-verify sbom-policy advisory
	$(call OK,quality gate passed)

## check — Fast local check: format/lint/typecheck/audit/compose/architecture/semgrep
check: format lint typecheck audit compose architecture semgrep
	$(call OK,check complete)

## ci — CI-safe subset (includes authoritative SBOM gates)
ci: install format lint typecheck test audit security compose architecture semgrep sbom-verify sbom-policy
	$(call OK,ci complete)

## full — Alias for all
full: all
	$(call OK,full run complete)
