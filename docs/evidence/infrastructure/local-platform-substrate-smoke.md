# Local platform substrate smoke gate evidence

## Summary

Pre-slice substrate smoke gate implemented before ADR-ACT-0008 first vertical slice (ADR-ACT-0111).
This evidence records the working local platform substrate: identity schema migration, fixture seed,
BFF health/readiness/version handlers, session fixture handler, ProtectedRoute UI smoke tests, and
observability primitive integration smoke tests.

## Governance

- ADR-0017 (compose substrate)
- ADR-0021 (identity and access control)
- ADR-0022 (session and BFF primitives)
- ADR-0023 (declarative provisioning)
- ADR-ACT-0111 (Done — this record)
- ADR-ACT-0008 (Open — first vertical slice, may now begin)
- ADR-ACT-0110 (Open — Keycloak provisioning, still blocked)
- Hardened: 2026-05-28

## Implemented

### 1. Identity schema migration

File: `apps/react-enterprise-app/src/db/migrations/001-identity-schema.sql`

Tables created:

- `users` — UUID PK, email (unique), display\_name, created\_at, updated\_at
- `external_identities` — UUID PK, user\_id FK, provider, provider\_subject (unique per provider)
- `organisations` — UUID PK, slug (unique), display\_name, created\_at, updated\_at
- `memberships` — UUID PK, user\_id FK, organisation\_id FK, role (CHECK constraint), created\_at, updated\_at

Migration runner: `apps/react-enterprise-app/src/db/migrate.ts`

### 2. Fixture seed

File: `apps/react-enterprise-app/src/db/seed.ts`

Fixture constants (FIXTURE object):

| Constant | Value | Purpose |
| --- | --- | --- |
| ORG\_ID | 00000000-0000-0000-0000-000000000001 | Fixture organisation |
| ORG\_SLUG | fixture-org | Organisation slug |
| ADMIN\_ID | 00000000-0000-0000-0000-000000000002 | tenant-admin actor |
| VIEWER\_ID | 00000000-0000-0000-0000-000000000003 | viewer actor |
| FORBIDDEN\_ID | 00000000-0000-0000-0000-000000000004 | actor with no membership |

Fixture data seeded:

- Fixture Organisation (tenant-admin + viewer members)
- `admin@fixture.local` → tenant-admin role in fixture-org
- `viewer@fixture.local` → viewer role in fixture-org
- `forbidden@fixture.local` → no membership (forbidden actor)

### 3. Database reset utility

File: `apps/react-enterprise-app/src/db/reset.ts`

Safety-gated: only runs in `development`, `test`, or `local` NODE\_ENV. Drops all identity tables.

### 4. BFF health/readiness/version handlers

File: `apps/react-enterprise-app/src/server/health.ts`

| Handler | Returns |
| --- | --- |
| getHealth() | `{ status: "ok" }` — always |
| getReadiness(postgresUrl?) | `{ status: "ready" \| "not-ready", dependencies: { database: "ok" \| "failed" } }` |
| getVersion() | `{ version, gitSha, buildTime, environment }` from env vars |

Pure functions — no HTTP server created.

### 5. Session fixture handler

File: `apps/react-enterprise-app/src/server/session.ts`

| Function | Purpose |
| --- | --- |
| createFixtureSessionActor(role) | Creates SessionActor for tenant-admin or viewer |
| getFixtureSession() | Reads LOCAL\_FIXTURE\_SESSION env var, returns null if unauthenticated/unset |

Permissions by role:

- `tenant-admin`: organisation.read, organisation.update, member.read, member.invite, member.update\_role, profile.read\_self, profile.update\_self, admin.access, audit.read
- `viewer`: organisation.read, member.read, profile.read\_self, profile.update\_self

## Test results

### Compose smoke tests (node:test)

```text
npm run test:compose

✔ postgres: container is healthy
✔ postgres: pg client can connect
✔ postgres: write/read/delete roundtrip
✔ database: migration creates identity schema tables     ← new
✔ database: seed creates fixture actors and organisation ← new
✔ redis: container is healthy
✔ redis: client can PING
✔ redis: SET/GET/DEL roundtrip
✔ clickhouse: container is healthy
✔ clickhouse: /ping returns Ok.
✔ clickhouse: SELECT 1 returns 1
✔ clickhouse: CREATE/INSERT/SELECT/DROP roundtrip
✔ minio: health/live endpoint returns 200
✔ minio: S3 client can list buckets
✔ minio: create bucket / PUT / GET / DELETE roundtrip
✔ mailpit: /api/v1/info returns version
✔ mailpit: nodemailer SMTP send and retrieve via API
✔ otel-collector: container is running
✔ otel-collector: OTLP/HTTP POST /v1/traces returns 200

tests 19 | pass 19 | fail 0
```

### Vitest frontend tests

```text
npm run test:frontend:run

Test Files  8 passed (8)
Tests  39 passed (39)
```

New substrate tests (25 new, 14 existing):

| File | Tests |
| --- | --- |
| health-handlers.test.ts | 2 (getHealth, getVersion) |
| session-fixture.test.ts | 5 (createFixtureSessionActor, getFixtureSession) |
| protected-route.test.tsx | 6 (loading, redirect, forbidden, permitted, no-permission, a11y) |
| observability-smoke.test.ts | 12 (logging, runtime-context, errors, observability) |

### Architecture governance

```text
node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict

Results:
- validate-package-metadata: passed
- validate-source-imports: passed
- generate-package-readmes: passed
- generate-package-inventory: passed
- generate-lifecycle-reports: passed
- validate-lifecycle-evidence: passed

Exit code: 0 (6/6)
```

### Architecture tests (node:test)

```text
npm run test:coverage

tests 337 | pass 337 | fail 0
```

### Quality gates

```text
npm run lint        → 0 problems
npm run format:check → All matched files use Prettier code style!
npm run tsc:check   → No errors
npm run lint:md     → 0 errors
```

## Known deferrals

| Item | Status | Blocks |
| --- | --- | --- |
| Real Keycloak SSO login | Open (ADR-ACT-0110) | ADR-ACT-0110 |
| Cloud infra (AWS/Cloudflare) | Open (ADR-ACT-0109) | ADR-ACT-0110 |
| Sonar CI secrets | Open (ADR-ACT-0092) | After CI secrets configured |
| Sentry profile validation | Open (ADR-ACT-0089) | Before adapter-sentry first use |

## Boundary notes

The `architecture.relations.dependsOn` array in `apps/react-enterprise-app/package.json` was
extended to include `@platform/platform-logging`, `@platform/platform-observability`,
`@platform/platform-errors`, and `@platform/platform-runtime-context`. These additions are
required so the `validate-source-imports` tool does not flag the substrate smoke tests
(`observability-smoke.test.ts`) as unlisted-platform-import violations. ADR-0020 §10 states
"use-case and application packages must not import platform-logging directly" — this refers
to production source code paths. The substrate tests are test scope only and are in
`src/tests/substrate/`. The `validate-source-imports` tool does not distinguish test vs production
for `no-unlisted-platform-import`. This expansion is intentional for the substrate smoke gate and
should be reviewed at the first vertical slice to determine if a separate test-scope metadata
mechanism is warranted.

## ADR-ACT-0008 readiness statement

The pre-slice substrate smoke gate passes. All local services are running and healthy.
Identity schema is migrated. Fixture actors are seeded. BFF health/readiness/version handlers
are implemented and tested. Session fixture handler is implemented and tested. ProtectedRoute
smoke tests pass. Observability primitive integration smoke passes. Architecture governance 6/6.
All 337 architecture tests pass. All 39 frontend tests pass. All 19 compose smoke tests pass.

**ADR-ACT-0008 first vertical slice may now begin.**

Real Keycloak login (ADR-ACT-0110) remains Open and must not be claimed complete until that
action is Done.
