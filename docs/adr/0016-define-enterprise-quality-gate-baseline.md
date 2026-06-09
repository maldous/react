# ADR-0016: Define enterprise quality gate and security baseline

## Status

Accepted

## Date

2026-05-27

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture)
- ADR-0002 (bounded contexts)
- ADR-0007 (artifact and repository layout)
- ADR-0011 (architecture tooling execution model)
- ADR-0012 (architecture tooling test strategy)
- ADR-ACT-0084 (quality gate implementation)

## Context

The repository has an architecture governance layer (validate-source-imports, validate-package-metadata, orchestrator, architecture tests) that enforces structural decisions made in ADR-0001 through ADR-0015. Before the first vertical slice (ADR-ACT-0008), the platform requires a second layer covering code quality, security, and documentation hygiene.

Without this layer:

- Formatting and markdown drift accumulates and is expensive to fix post-feature delivery.
- Vulnerable dependencies can be introduced silently.
- Secrets and credentials have no automated detection.
- The import boundary checker does not validate general code quality.
- Security analysis (CodeQL, SonarQube) is not present from day one.

The repository is currently a governed skeleton. Some tooling (Knip, dependency-cruiser, Sonar) will produce false positives until the first vertical slice stabilises real exports, imports, and test coverage. Those tools must remain advisory until the signal-to-noise ratio is useful.

## Stakeholder concerns

- **Engineering:** Hard gates must not block skeleton package development with false positives.
- **Security:** High/critical CVEs, committed secrets, and security anti-patterns must be detected before merge.
- **Architecture:** validate-source-imports must remain the sole authoritative ADR import-boundary gate; ESLint and other tools must not duplicate the full ADR import matrix.
- **Operations:** Gate failures in CI must be actionable ? not noise from advisory tools.
- **Governance:** Evidence of quality gate configuration must be committed and version-controlled.
- **Compliance:** SBOM, license policy, and OSV scanning baselines are required before production readiness.

## Decision drivers

1. Gates must be proportional to the risk they address.
2. Hard gates must be deterministic (same input ? same result) and false-positive-free in skeleton state.
3. Advisory gates must not fail CI; they are informational until stabilised.
4. validate-source-imports and the architecture orchestrator are the authoritative governance gates; other tools are complementary.
5. ESLint and dependency-cruiser must not encode ADR import-boundary rules ? the custom validator owns that logic.
6. Tooling decisions must be recorded in evidence so gate changes are traceable.

## Options considered

### Option A: Architecture gates only (no external tooling)

Add no external quality tools. Rely solely on validate-source-imports, validate-package-metadata, and the orchestrator.

Pros:

- Zero false positives.
- Minimal CI complexity.

Cons:

- No formatting enforcement ? byte-level drift accumulates.
- No security scanning ? CVEs and secrets undetected.
- No code quality baseline ? technical debt is invisible.

Risks:

- Security incidents from undetected vulnerabilities or committed secrets.
- Expensive formatting and lint remediation during feature delivery.

### Option B: All-hard gates from day one

Make every tool a hard CI gate: formatting, lint, audit, OSV, gitleaks, Knip, dependency-cruiser, Sonar, SBOM.

Pros:

- Maximum gate coverage immediately.

Cons:

- Knip, dependency-cruiser, and Sonar produce skeleton false positives ? blocks developers until first slice.
- Over-gates CI before useful signal exists.

Risks:

- Gate fatigue ? developers learn to ignore or bypass CI.

### Option C: Layered model with staged promotion (chosen)

Three-tier model:

1. **Authoritative architecture gates** ? always hard; validate-source-imports, validate-package-metadata, orchestrator, architecture tests.
2. **Hard quality/security gates** ? always hard; deterministic tools where false positives in skeleton state are not expected.
3. **Advisory gates** ? report-only until first vertical slice stabilises real signal.

Promotion rule: advisory gates become hard only after the first vertical slice ships real exports, imports, dependencies, and test coverage.

Pros:

- Hard gates block real issues without skeleton noise.
- Advisory tools produce useful information from day one.
- Clear promotion path prevents advisory gates from remaining advisory indefinitely.

Cons:

- Requires discipline to promote advisory to hard after the first slice.

Risks:

- Advisory gates may be deprioritised post-slice. Mitigation: ADR-ACT follow-up required for each promotion decision.

## Decision

The repository uses a three-tier quality-gate model.

### Tier 1 ? Authoritative architecture gates (always hard)

These enforce the decisions made in ADR-0001 through ADR-0015:

| Gate                          | Command      | Tooling                      |
| ----------------------------- | ------------ | ---------------------------- |
| Package metadata validation   | orchestrator | validate-package-metadata    |
| Import boundary validation    | orchestrator | validate-source-imports      |
| Lifecycle evidence validation | orchestrator | validate-lifecycle-evidence  |
| Architecture tooling tests    | node --test  | Node.js built-in test runner |

validate-source-imports is the sole authoritative gate for ADR import boundaries. No other tool may duplicate or override its rule set.

### Tier 2 ? Hard quality and security gates

These run on every push and PR. Failure blocks merge:

| Gate                   | Tool               | Version               | Command                                 |
| ---------------------- | ------------------ | --------------------- | --------------------------------------- |
| Formatting             | Prettier           | 3.8.3                 | `npm run format:check`                  |
| Markdown lint          | markdownlint-cli2  | 0.22.1                | `npm run lint:md`                       |
| Code lint              | ESLint flat config | 10.4.0                | `npm run lint`                          |
| Dependency audit       | npm audit          | bundled               | `npm run audit:deps`                    |
| OSV vulnerability scan | osv-scanner        | 1.9.0                 | `npm run audit:osv`                     |
| Secret detection       | gitleaks           | action@v2             | CI only (gitleaks-action)               |
| Security analysis      | CodeQL             | action@v3             | `.github/workflows/codeql.yml`          |
| Code quality baseline  | SonarQube          | lts-community (local) | `npm run sonar:clean` (local pre-slice) |

SonarQube is required locally as a pre-slice hard gate using a custom "Governance Tooling" quality gate (bugs=0, vulnerabilities=0, security_hotspots_reviewed=100%, reliability_rating=A, security_rating=A, maintainability_rating=A, code_smells=0). Coverage and duplication thresholds are not enforced because: (1) architecture tooling uses `node --test` without LCOV generation, and (2) similar argument-parsing patterns across tools are intentional and architecturally consistent. Coverage tooling is tracked separately. Sonar runs as a **test-stage** promotion gate (`scripts/stages/run-stage.sh` step 9), not in CI — see ADR-ACT-0092 (Done, 2026-06-09): CI runs the architecture orchestrator and the Tier-2 hard gates; SonarQube stays in the test environment by design.

ESLint is configured with two buckets (Node.js tooling; TypeScript packages and apps). It must not encode ADR import-boundary rules ? validate-source-imports owns that logic exclusively.

### Tier 3 ? Advisory / report-only gates

Most run in CI but never fail the build. SonarQube is a **pre-slice hard baseline gate** ? see Tier 2 addition below. Other advisory gates become hard after the first vertical slice:

| Gate                       | Tool               | Promotion trigger                                                              |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| Unused exports/deps        | Knip               | First slice exports real symbols                                               |
| Dependency graph           | dependency-cruiser | First slice defines real import graph                                          |
| Code quality ? pre-slice   | SonarQube          | **Pre-slice hard baseline** ? zero bugs, vulns, hotspots, code smells required |
| Software bill of materials | CycloneDX npm      | Before production readiness review                                             |
| License compliance         | license-checker    | Before production readiness review                                             |

### Ignored paths (all tools)

- `**/node_modules/**`
- `reports/` (generated, gitignored)
- `tools/architecture/**/tests/fixtures/` (intentionally varied/broken code)

Prettier additionally excludes:

- `docs/evidence/` (byte-stable committed governance evidence)
- Generated package READMEs (`apps/**/README.md`, `packages/**/README.md`, `tools/architecture/**/README.md`)
- `**/package-lock.json`
- `.remember/**` (auto-generated session memory, gitignored)

### Evidence and version control

All quality gate configuration is committed. Evidence is committed under `docs/evidence/quality-gates/`. Changes to gate configuration or gate tier require an evidence update.

### Promotion rule

Advisory gates are promoted to hard only when all of the following are true:

1. The first vertical slice has shipped real code.
2. The tool produces zero false positives against the post-slice codebase.
3. An ADR-ACT entry is filed for the promotion with evidence.

## Rationale

Option C is chosen because:

- Hard gates must be zero-noise in skeleton state. Knip, dependency-cruiser, and Sonar all produce expected false positives against stub exports and empty packages. Making them hard before the first slice would block development.
- Security tools (OSV, gitleaks, npm audit, CodeQL) have no skeleton false positives and correctly block real risks.
- Formatting and lint are deterministic and false-positive-free by construction.
- The layered model preserves the commitment to not block CI unnecessarily while ensuring real security and quality issues are caught immediately.

## Consequences

**Positive:**

- Security vulnerabilities and committed secrets are blocked from merge from day one.
- Formatting and markdown are deterministic across all contributors.
- Code quality (Sonar), license compliance, and SBOM baselines are in place before production readiness review.
- Architecture boundaries are enforced independently of general code quality tools.

**Negative:**

- CI becomes stricter before feature delivery begins.
- Advisory tools must be explicitly promoted; this requires ongoing discipline post-first-slice.
- SonarQube is a required **test-stage** promotion gate (run-stage.sh step 9), run against the shared instance with an auto-provisioned token; it is intentionally not a CI gate (ADR-ACT-0092, Done).

**Neutral / operational:**

- Adding a new package requires passing all hard gates (formatting, lint, security) but not advisory gates.
- Changing gate configuration requires updating `docs/evidence/quality-gates/` evidence.
- The `reports/` directory is gitignored; only committed evidence is version-controlled.
- HTTP response security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, `Cache-Control`) are part of the security baseline and are enforced by the Caddy reverse proxy for all virtual hosts. Changes to the header policy require updating the Caddyfile and evidence.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting and tooling configuration
- Human review status: Reviewed by architecture owner
- Evidence checked: docs/evidence/quality-gates/enterprise-quality-gate-baseline.md
- Validation required: All hard gates verified passing (see evidence)

## Validation / evidence

Evidence level: High

Evidence file: `docs/evidence/quality-gates/enterprise-quality-gate-baseline.md`

All hard gates verified passing at commit `5f91d68` and subsequently.

## Impacted areas

- Architecture: Tier 1 gates unchanged; Tier 2/3 gates added.
- Security: Hard gates block CVEs, secrets, security anti-patterns.
- Operations: CI has two jobs: quality-gates and architecture-checks.
- Testing: Architecture tooling tests remain in the architecture-checks job.
- Delivery: CI workflow updated.
- Documentation: Evidence committed; ADR-0007 amended for quality-gates evidence category.

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-27

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0007: Repository layout ? evidence directory structure
- ADR-0011: Architecture tooling execution model
- ADR-0012: Architecture tooling test strategy
- ADR-ACT-0084: Implementation of quality gate baseline
- `docs/evidence/quality-gates/enterprise-quality-gate-baseline.md`
- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- Prettier: <https://prettier.io>
- markdownlint-cli2: <https://github.com/DavidAnson/markdownlint-cli2>
- ESLint: <https://eslint.org>
- osv-scanner: <https://github.com/google/osv-scanner>
- gitleaks: <https://github.com/gitleaks/gitleaks>
- CodeQL: <https://codeql.github.com>
- SonarQube: <https://www.sonarsource.com/products/sonarqube/>
- CycloneDX: <https://cyclonedx.org>
- Knip: <https://knip.dev>
- dependency-cruiser: <https://github.com/sverweij/dependency-cruiser>

## Notes

Tier 3 promotion decisions (Knip, dependency-cruiser, Sonar, SBOM, license) are tracked as separate ADR-ACT entries after the first vertical slice. No advisory gate should remain advisory indefinitely ? each must either be promoted or explicitly retired.
