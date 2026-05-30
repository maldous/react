# Enterprise quality gate baseline evidence

## Summary

Complete pre-slice quality baseline with LCOV coverage. All hard gates pass. SonarQube reports 83.10% overall coverage. ADR-ACT-0008 (first vertical slice) may now proceed.

## Governance

- ADR-0016 (quality gate policy ? accepted)
- ADR-ACT-0084 (initial implementation ? Done)
- ADR-ACT-0085 (ADR-0016 creation ? Done)
- ADR-ACT-0091 (Sonar clean baseline ? Done)
- ADR-ACT-0092 (Sonar CI wiring ? Open)
- ADR-ACT-0093 (LCOV coverage ingestion ? **Done**)
- Committed: 2026-05-28

## Tools configured

| Tool | Version | Gate type | Command |
| --- | --- | --- | --- |
| Prettier | 3.8.3 | Hard | `npm run format:check` |
| markdownlint-cli2 | 0.22.1 | Hard | `npm run lint:md` |
| ESLint (flat config) | 10.4.0 | Hard | `npm run lint` |
| TypeScript strict | 6.0.3 | Hard | `npm run tsc:check` |
| npm audit | bundled | Hard | `npm run audit:deps` |
| osv-scanner | 1.9.0 (snap) | Hard | `npm run audit:osv` / CI action |
| gitleaks | action@v2 | Hard (CI only) | `gitleaks/gitleaks-action@v2` |
| CodeQL | action@v3 | Hard (CI only) | `.github/workflows/codeql.yml` |
| **SonarQube + LCOV** | lts-community 9.9.8 | **Hard (local pre-slice)** | `npm run sonar:clean` |
| Knip | 6.14.2 | Advisory | `npm run knip` |
| dependency-cruiser | 17.4.2 | Advisory | `npm run depcruise` |
| CycloneDX SBOM | 4.2.1 | Advisory | `npm run sbom:generate` |
| license scanner | ? | Advisory (deferred, ADR-ACT-0090) | ? |

## SonarQube baseline ? clean with LCOV coverage

### Quality gate: Governance Tooling ? OK

| Metric | Value | Threshold | Status |
| --- | --- | --- | --- |
| Bugs | 0 | 0 | ? |
| Vulnerabilities | 0 | 0 | ? |
| Security hotspots | 0 | 0 | ? |
| Code smells | 0 | ? | ? |
| Reliability rating | A | A | ? |
| Security rating | A | A | ? |
| Maintainability rating | A | A | ? |

### Coverage metrics (advisory threshold ? hard after ADR-ACT-0008)

| Metric | Value |
| --- | --- |
| Overall coverage | **83.10%** |
| Line coverage | **83.70%** |
| Branch coverage | **80.10%** |
| Lines to cover | 4413 |
| Uncovered lines | 721 |

Scan details:

- Server: `http://localhost:9003` (Docker Compose quality profile)
- Project key: `maldous-react`
- LCOV path: `coverage/lcov.info`
- Coverage tool: Node.js built-in V8 (`--experimental-test-coverage`)
- Scan timestamp: 2026-05-28T00:26Z
- Quality gate script: `tools/quality/sonar-quality-gate.mjs`

### Coverage generation

```bash
npm run test:coverage
# Generates coverage/lcov.info via Node.js V8 coverage
# Scope: tools/architecture/*/src/**/*.mjs
# Test files: 10 (6 integration + 4 unit)
```

Test file breakdown:

| Test file | Type |
| --- | --- |
| validate-package-metadata.test.mjs | Integration (spawnSync) |
| validate-package-metadata-unit.test.mjs | Unit (in-process imports) |
| validate-source-imports.test.mjs | Integration (spawnSync) |
| validate-source-imports-unit.test.mjs | Unit (in-process imports) |
| generate-package-readmes.test.mjs | Integration (spawnSync) |
| generate-package-inventory.test.mjs | Integration (spawnSync) |
| validate-lifecycle-evidence.test.mjs | Integration (spawnSync) |
| validate-lifecycle-evidence-unit.test.mjs | Unit (in-process imports) |
| self-evidence.test.mjs | Integration (spawnSync) |
| orchestrator-unit.test.mjs | Unit (in-process imports) |

Unit test files cover: reporter functions, rules, package-map builder, scanner, parseArgs dispatch tables, validateBundle* helpers, orchestrator step catalog / plan builder.

### Coverage threshold policy

Coverage percentage threshold is **advisory until first vertical slice (ADR-ACT-0008)**. After slicing:

- Hard gate: ? measured baseline at slice point (no coverage regression)
- ADR-ACT-0093 tracks any threshold promotion decision

### Issues fixed before baseline (49 total ? previous commit)

All issues were in `tools/architecture/` governance tooling, not in product code.

| Rule | Type | Count | Fix |
| --- | --- | --- | --- |
| S2310 | Critical | 23 | while loop with i+1 read-ahead |
| S3776 | Critical | 20 | extracted helper functions |
| S3358 | Major | 2 | explicit if/else |
| S4624 | Major | 2 | extracted template variables |
| S5850 | Bug | 1 | explicit regex grouping |
| S1874 | Minor | 1 | replaced deprecated isTypeOnly |

### Quality gate design ? Governance Tooling

Custom gate differs from Sonar Way in one exclusion:

**Duplication not enforced** ? Similar argument-parsing patterns across governance tools are intentional (shared architectural convention).

Coverage threshold is present and non-zero; percentage threshold enforced after first slice.

## Hard gates (Tier 2) ? all passing

```text
npm run format:check    ? All matched files use Prettier code style!
npm run lint:md         ? 52 files, 0 errors
npm run lint            ? 0 problems
npm run tsc:check       ? 0 errors
npm run audit:deps      ? 0 vulnerabilities
npm run audit:osv       ? 5 lock files, 0 issues
npm run sonar:clean     ? Quality gate OK, 83.10% coverage
```

## Architecture gates (Tier 1) ? all passing

```text
node orchestrator all --strict   ? 6/6 passed
npm run test:architecture        ? 180 tests, 0 failures
```

## Advisory gates (Tier 3 ? report-only)

- Knip: configuration hints only (expected skeleton state)
- dependency-cruiser: no circular/architecture violations
- SBOM: CycloneDX 1.6 JSON, 381 components
- License scanner: deferred (ADR-ACT-0090)

## Sonar CI status

SonarQube runs locally before slicing. CI wiring (SONAR_TOKEN + SONAR_HOST_URL secrets) is tracked in ADR-ACT-0092. Until CI is wired, Sonar scan results are committed governance evidence.

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.** This evidence confirms the complete pre-slice baseline including LCOV coverage.

## What remains deferred

| Item | ADR-ACT |
| --- | --- |
| Sonar CI wiring (SONAR_TOKEN secrets) | ADR-ACT-0092 |
| Coverage percentage hard threshold | Post-ADR-ACT-0008 |
| Sentry profile validation | ADR-ACT-0089 |
| Automated license scanner | ADR-ACT-0090 |
| Knip/depcruise/Sonar promotion to hard CI | Post-first-slice |
