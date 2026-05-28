# Evidence: ADR-ACT-0008 — Authenticated Organisation Profile Slice

**Date:** 2026-05-28
**Status:** Done (hardened via ADR-ACT-0118; final audit pass 2026-05-28)
**Action:** ADR-ACT-0008
**ADR Ref:** ADR-0024

## Summary

First vertical slice proving the full React SPA → platform-api → Postgres integration path.
A functional first pass was implemented, then hardened into canonical hexagonal architecture
via ADR-ACT-0118 before treating it as the canonical pattern for future slices.

## Architecture shape (canonical, post-ADR-ACT-0118)

1. **React protected route** (`/organisation/profile`) — `ProtectedRoute` checks `organisation.read` via `useSession()`
2. **TanStack Query** — `useOrganisationProfile` fetches from `/api/organisation/profile`
3. **Contract client** — `organisation-client.ts` typed via `@platform/contracts-organisation`
4. **Production route list** — `server/routes.ts` (shared by `http.ts` and all tests)
5. **Pipeline permission guard** — `organisation.read` (GET) / `organisation.update` (PATCH)
6. **Handler** — `server/organisation.ts` wires `PostgresOrganisationRepository` into use case via DI
7. **Use case** — `usecases/organisation.ts` receives `OrganisationRepository` dep; calls `normaliseOrganisationDisplayName`; throws typed errors; no SQL, no pg import
8. **Repository port** — `ports/organisation-repository.ts` (`OrganisationRepository` interface)
9. **Postgres adapter** — `adapters/postgres-organisation-repository.ts` owns SQL and row mapping
10. **Local Postgres** — `organisations` table; fixture seed
11. **Structured logs + traces** — `requestId`, `actorId`, `tenantId`, `organisationId`, explicit `operationName` propagated

## Shortcuts fixed (ADR-ACT-0118)

| Shortcut | Fixed |
| -------- | ----- |
| `usecases/organisation.ts` imported `pg` directly | Removed — DI via `OrganisationRepository` port |
| Routes duplicated in tests | `server/routes.ts` exported; shared by `http.ts` and tests |
| `no-permissions` fixture had organisationId | Replaced with `no-membership` (empty tenantId/organisationId) |
| Operation name was raw path string | Explicit `operationName` field on `Route` |
| No domain validation for displayName | `normaliseOrganisationDisplayName()` trims, validates length/chars |

## Final audit hardening (2026-05-28)

| Shortcut | Fixed |
| -------- | ----- |
| Use case held module-level `createLogger`/`createTracer` globals | Use case is now pure: only repo orchestration + business validation; logging/tracing owned by pipeline layer |
| Both handlers duplicated `POSTGRES_URL` + `new PostgresOrganisationRepository(...)` wiring | New `apps/platform-api/src/server/dependencies.ts` centralises `getPostgresUrl()`, `getOrganisationRepository()`, `createOrganisationDependencies()` |
| Adapter opened a fresh `pg.Client` per call | Adapter now owns a shared `pg.Pool` (max 10) constructed once per process |
| `apps/platform-api/src/server/health.ts` contained raw `SELECT 1` | Extracted to `adapters/postgres-readiness-adapter.ts` (`PostgresReadinessAdapter.ping()`); `server/` contains zero raw SQL |
| Contract `min(1).max(100)` disagreed with domain `min(2).max(120)` | `UpdateOrganisationProfileRequestSchema` aligned to `min(2).max(120)`, made `.strict()` so unknown fields (slug, id, tenantId) are rejected at the contract boundary with 400 instead of silently dropped |

## New package

| Package | Path | Lifecycle |
| ------- | ---- | --------- |
| `@platform/contracts-organisation` | `packages/contracts-organisation` | `experimental.contract` |

## New files (ADR-ACT-0118)

| File | Purpose |
| ---- | ------- |
| `apps/platform-api/src/ports/organisation-repository.ts` | Repository interface |
| `apps/platform-api/src/adapters/postgres-organisation-repository.ts` | pg implementation |
| `apps/platform-api/src/server/routes.ts` | Production route list |
| `apps/platform-api/tests/unit/organisation-validation.test.ts` | Validation unit tests (11 tests) |
| `apps/platform-api/tests/unit/organisation-usecase.test.ts` | Use case unit tests with fake repo (11 tests) |
| `apps/platform-api/tests/substrate/postgres-organisation-repository.test.ts` | Adapter integration tests (7 tests) |

## New files (final audit hardening)

| File | Purpose |
| ---- | ------- |
| `apps/platform-api/src/server/dependencies.ts` | Composition root: POSTGRES_URL + shared adapter singletons |
| `apps/platform-api/src/adapters/postgres-readiness-adapter.ts` | Owns readiness `SELECT 1` SQL |

## Fixture roles

| Role | GET | PATCH | Semantics |
| ---- | --- | ----- | --------- |
| `tenant-admin` | 200 | 200 | Full permissions + organisationId |
| `viewer` | 200 | 403 | Read-only permissions |
| `no-membership` | 403 | 403 | Authenticated, no tenantId/organisationId, no permissions |
| `unauthenticated` | 401 | 401 | No session |

## Boundary checks passed

- No `pg` import in usecases, React SPA, UI, or features ✓
- No raw SQL in `apps/platform-api/src/server` or `apps/platform-api/src/usecases` (readiness probe lives in `adapters/postgres-readiness-adapter.ts`) ✓
- No server runtime imports in React SPA/UI/features ✓
- `contracts-organisation` has zero `@platform/*` dependencies ✓
- `validate-source-imports --strict`: 0 violations ✓

## Test counts

| Suite | Count | Runner |
| ----- | ----- | ------ |
| `unit/organisation-validation` | 11 | node:test |
| `unit/organisation-usecase` | 11 | node:test (fake repo) |
| `substrate/postgres-organisation-repository` | 7 | node:test (real Postgres) |
| `substrate/organisation-profile` | 15 | node:test (production routes, real Postgres) |
| `substrate/session-fixture` | updated | node:test |
| Frontend (Vitest) | 6 | vitest |
| Compose smoke | 2 | node:test (organisation tests within 25-test suite) |
| E2E (Playwright) | 13 | playwright |

## Constraints honoured

- No real Keycloak — fixture `LOCAL_FIXTURE_SESSION` only
- `ADR-ACT-0110` (Keycloak) remains Open
- `validate-source-imports --strict` passes
- `make check` passes
- `make pre-slice-gate` passes
