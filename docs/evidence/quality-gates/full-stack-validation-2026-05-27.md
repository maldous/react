# Full-stack validation ? 2026-05-27

## Scope

Complete validation of all ADR-mandated gates and compose service smoke tests, executed before the first vertical slice (ADR-ACT-0008). Covers:

- All Tier 1 architecture gates (ADR-0016)
- All Tier 2 hard quality/security gates (ADR-0016)
- All Tier 3 advisory gates with results captured (ADR-0016)
- Compose service smoke tests ? full roundtrips (ADR-0017)
- TypeScript strict compilation (new hard gate)

## Governance

- ADR-0016 (quality gate policy)
- ADR-0017 (compose substrate)
- Commit: pending (this session)

---

## Tier 1 ? Architecture gates (always hard)

| Tool | Result | Notes |
| --- | --- | --- |
| validate-package-metadata | **passed** | All packages pass schema and lifecycle checks |
| validate-source-imports | **passed** | No import boundary violations |
| validate-lifecycle-evidence | **passed** | No evidence files to validate yet |
| generate-package-readmes | **passed** | All READMEs regenerate cleanly |
| generate-package-inventory | **passed** | Package inventory generates cleanly |
| generate-lifecycle-reports | **passed** | No lifecycle issues |
| Architecture tooling tests | **6/6 passed** | All test files pass |

---

## Tier 2 ? Hard quality and security gates

| Gate | Tool | Result | Detail |
| --- | --- | --- | --- |
| format:check | Prettier 3.8.3 | **passed** | All matched files use Prettier code style |
| lint:md | markdownlint-cli2 0.22.1 | **passed** | 51 files, 0 errors |
| lint | ESLint flat config 10.4.0 | **passed** | 0 problems |
| tsc:check | TypeScript 6.0.3 strict | **passed** | 0 errors ? gate added this session |
| audit:deps | npm audit --audit-level=high | **passed** | 0 vulnerabilities |
| audit:osv | osv-scanner 1.9.0 | **passed** | All lock files scanned, 0 issues |
| compose:config | docker compose config | **passed** | YAML valid, all services parsed |
| secrets:scan | gitleaks | **passed** | no leaks found |

### TypeScript strict settings

`tsconfig.base.json` enables:

- `strict: true` (noImplicitAny, strictNullChecks, strictFunctionTypes, strictPropertyInitialization, etc.)
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `isolatedModules: true`

Current yield: 0 errors (skeleton state). Gate value: catches regressions when real code lands.

---

## Tier 3 ? Advisory gates (report-only per ADR-0016)

These do not block the build. Results captured for visibility.

### Knip (unused exports/deps)

Expected skeleton output ? all `packageName` exports are unused stubs. Advisory until first vertical slice.

```text
Configuration hints (5) ? remove unneeded ignore patterns from knip.json
validatePackageMap / getPackageForFile ? unused in validate-source-imports
(all package stubs: packageName exported but not consumed elsewhere)
```

### dependency-cruiser

```text
validate-source-imports/tests/validate-source-imports.test.mjs ? assert/strict
validate-source-imports/tests/validate-source-imports.test.mjs ? child_process
validate-source-imports/tests/validate-source-imports.test.mjs ? fs, os, path
(Node.js built-ins ? not real violations; depcruiser doesn't know node: imports)
```

No circular dependencies. No product-imports-architecture violations.

### SonarQube (quality profile)

```text
EXECUTION SUCCESS
166 files indexed
Dashboard: http://localhost:9003/dashboard?id=maldous-react
```

Token: generated for Docker Compose SonarQube instance (port 9003). Previous SONAR_HOST_URL env var pointed to dead /opt instance ? resolved by explicit `-Dsonar.host.url` in npm script.

---

## Compose service smoke tests (ADR-0017)

**17/17 passed.** Full roundtrips verified for all default profile services.

| Service | Tests | Result | Client used |
| --- | --- | --- | --- |
| postgres | healthy + pg connect + write/read/delete | **3/3 passed** | `pg` npm |
| redis | healthy + PING + SET/GET/DEL | **3/3 passed** | `redis` npm |
| clickhouse | healthy + /ping + SELECT 1 + CREATE/INSERT/SELECT/DROP | **4/4 passed** | `fetch` (HTTP) |
| minio | health/live + list buckets + PUT/GET/DELETE roundtrip | **3/3 passed** | `@aws-sdk/client-s3` npm |
| mailpit | /info + SMTP send + API retrieve | **2/2 passed** | `nodemailer` npm + `fetch` |
| otel-collector | running + OTLP/HTTP POST /v1/traces ? 200 | **2/2 passed** | `fetch` |

### Issues resolved during smoke test development

| Issue | Resolution |
| --- | --- |
| `@aws-sdk/client-s3@3.826.0` critical CVE (fast-xml-parser) | Updated to 3.1054.0 |
| `nodemailer@7.0.3` high CVEs | Updated to 8.0.9 |
| ClickHouse `default` user network-restricted to 127.0.0.1 | Created `platform` user with HOST ANY; added env vars to compose.yaml |
| ClickHouse DDL/DML via GET ? READONLY error | `chQuery` uses POST for writes, GET for SELECT |
| `SONAR_HOST_URL=http://localhost:9000` env var conflict | Added `-Dsonar.host.url=http://localhost:9003` to sonar:scan script |

---

## New hard gate added: tsc:check

`tsc --noEmit -p apps/react-enterprise-app/tsconfig.json` added as a Tier 2 hard gate. TypeScript 6.0.3 with strict mode. Added to CI `quality-gates` job. Configuration:

- `tsconfig.base.json` at repo root with all strict flags
- `apps/react-enterprise-app/tsconfig.json` extending base + JSX react-jsx

---

## Deferred (per ADR-0016)

- Knip/depcruise/Sonar promotion to hard gate ? after first vertical slice
- `license:check` ? ADR-ACT-0086 (tool selection pending)
- Compose smoke tests in CI ? requires live services; not suitable for CI (ADR-0017)
- Package-level TypeScript (`packages/**/src/index.ts`) ? stub state; add per-package tsconfig when first real package code lands

---

## System state at time of validation

- Services running: postgres, redis, clickhouse, minio, mailpit, otel-collector (all healthy)
- SonarQube: running via quality profile
- System services disabled: postgresql (5432), redis-server (6379), mailhog (1025)
- Port remappings: postgres 5433, clickhouse-http 8124
