# Enterprise quality gate baseline evidence

## Summary

Complete pre-slice quality baseline. All hard gates pass. SonarQube has been promoted from advisory to a required pre-slice gate with zero open issues. ADR-ACT-0008 (first vertical slice) may now proceed.

## Governance

- ADR-0016 (quality gate policy — accepted)
- ADR-ACT-0084 (initial implementation — Done)
- ADR-ACT-0085 (ADR-0016 creation — Done)
- ADR-ACT-0091 (Sonar clean baseline — **Done**)
- ADR-ACT-0092 (Sonar CI wiring — Open)
- Committed: 2026-05-27

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
| **SonarQube** | lts-community 9.9.8 | **Hard (local pre-slice)** | `npm run sonar:clean` |
| Knip | 6.14.2 | Advisory | `npm run knip` |
| dependency-cruiser | 17.4.2 | Advisory | `npm run depcruise` |
| CycloneDX SBOM | 4.2.1 | Advisory | `npm run sbom:generate` |
| license scanner | — | Advisory (deferred, ADR-ACT-0090) | — |

## SonarQube baseline — clean

### Quality gate: Governance Tooling — OK

| Metric | Value | Threshold | Status |
| --- | --- | --- | --- |
| Bugs | 0 | 0 | ✓ |
| Vulnerabilities | 0 | 0 | ✓ |
| Security hotspots | 0 | 0 | ✓ |
| Code smells | 0 | — | ✓ |
| Reliability rating | A | A | ✓ |
| Security rating | A | A | ✓ |
| Maintainability rating | A | A | ✓ |

Scan details:

- Server: `http://localhost:9003` (Docker Compose quality profile)
- Project key: `maldous-react`
- Files indexed: 166
- Scan timestamp: 2026-05-27T13:49Z
- Quality gate script: `tools/quality/sonar-quality-gate.mjs`

### Issues fixed before baseline (49 total)

All issues were in `tools/architecture/` governance tooling, not in product code.

| Rule | Type | Severity | Count | Fix applied |
| --- | --- | --- | --- | --- |
| S2310 | Code smell | Critical | 23 | Converted `for` loops with inner `++index` to `while` loops with `i + 1` read-ahead |
| S3776 | Code smell | Critical | 20 | Extracted helper functions to reduce cognitive complexity below threshold |
| S3358 | Code smell | Major | 2 | Replaced nested ternaries with explicit `if/else` blocks |
| S4624 | Code smell | Major | 2 | Extracted inner template literals to named variables |
| S5850 | Bug | Major | 1 | Added explicit parentheses to regex alternation in `validate-lifecycle-evidence` |
| S1874 | Code smell | Minor | 1 | Replaced deprecated `isTypeOnly` with `phaseModifier` in scanner |

### Quality gate design — Governance Tooling

The custom "Governance Tooling" gate differs from Sonar Way in two exclusions:

**Coverage not enforced** — `architecture tooling` uses `node --test` which does not generate LCOV by default. Setting up V8-to-LCOV pipeline is tracked in ADR-ACT-0092.

**Duplication not enforced** — Similar argument-parsing patterns across governance tools are intentional (shared architectural convention). Cross-tool duplication in `parseArgs` dispatch tables is not a maintenance risk; it is consistent governance code.

## Hard gates (Tier 2) — all passing

```text
npm run format:check    → All matched files use Prettier code style!
npm run lint:md         → 52 files, 0 errors
npm run lint            → 0 problems
npm run tsc:check       → 0 errors
npm run audit:deps      → 0 vulnerabilities
npm run audit:osv       → 5 lock files, 0 issues
npm run sonar:clean     → Quality gate OK, 0 issues
```

## Architecture gates (Tier 1) — all passing

```text
node orchestrator all --strict   → 6/6 passed
node --test (6 test files)       → 6 pass, 0 fail
```

## Advisory gates (Tier 3 — report-only)

- Knip: configuration hints only (expected skeleton state)
- dependency-cruiser: no circular/architecture violations
- SBOM: CycloneDX 1.6 JSON, 381 components
- License scanner: deferred (ADR-ACT-0090)

## Sonar CI status

SonarQube runs locally before slicing. CI wiring (SONAR_TOKEN + SONAR_HOST_URL secrets) is tracked in ADR-ACT-0092. Until CI is wired, Sonar scan results are committed governance evidence.

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.** This evidence establishes the clean pre-slice baseline required before slicing begins.

## What remains deferred

| Item | ADR-ACT |
| --- | --- |
| Sonar CI wiring (SONAR_TOKEN secrets) | ADR-ACT-0092 |
| Sentry profile validation | ADR-ACT-0089 |
| Automated license scanner | ADR-ACT-0090 |
| Knip/depcruise/Sonar promotion to hard CI | Post-first-slice |
| Coverage reporting (V8 → LCOV pipeline) | ADR-ACT-0092 |
