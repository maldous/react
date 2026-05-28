# Evidence: ADR-ACT-0008 — Authenticated Organisation Profile Slice

**Date:** 2026-05-28
**Status:** Done
**Action:** ADR-ACT-0008
**ADR Ref:** ADR-0024

## Summary

First vertical slice proving the full React SPA → platform-api → Postgres integration path using fixture session actors (no real Keycloak).

## Stack traversed

1. **React protected route** (`/organisation/profile`) — `ProtectedRoute` checks `organisation.read` via `useSession()`
2. **TanStack Query** — `useOrganisationProfile` fetches from `/api/organisation/profile`
3. **Contract client** — `organisation-client.ts` calls platform-api with typed contract types from `@platform/contracts-organisation`
4. **platform-api permission guard** — `createRouter` enforces `organisation.read` (GET) and `organisation.update` (PATCH)
5. **Use case** — `getOrganisationProfile` / `updateOrganisationDisplayName` in `apps/platform-api/src/usecases/organisation.ts`
6. **Postgres** — queries `organisations` table; `display_name` column is mutable
7. **Structured logs** — `requestId`, `actorId`, `tenantId` propagated through `RuntimeContext`

## New package

| Package                            | Path                              | Lifecycle               |
| ---------------------------------- | --------------------------------- | ----------------------- |
| `@platform/contracts-organisation` | `packages/contracts-organisation` | `experimental.contract` |

## Fixture roles validated

| Role              | GET | PATCH |
| ----------------- | --- | ----- |
| `tenant-admin`    | 200 | 200   |
| `viewer`          | 200 | 403   |
| `no-permissions`  | 403 | N/A   |
| `unauthenticated` | 401 | 401   |

## Test coverage

- **platform-api (node:test):** 11 new tests in `organisation-profile.test.ts`
- **session-fixture (node:test):** 1 new test for `no-permissions` role
- **frontend (Vitest):** 6 new tests in `organisation-profile.test.tsx`
- **compose smoke:** 2 new tests for `getOrganisationProfile` and `updateOrganisationDisplayName`
- **E2E (Playwright):** 4 new tests in `smoke.test.ts` organisation profile suite

## Constraints honoured

- React app imports only: `@platform/contracts-organisation` (types), `@platform/ui-design-system`, `@platform/contracts-auth` (via useSession), `@hookform/resolvers`, `react-hook-form`, `zod`, `@tanstack/react-query`
- `contracts-organisation` has zero `@platform/*` dependencies
- No real Keycloak used — fixture `LOCAL_FIXTURE_SESSION` env var only
- `ADR-ACT-0110` (Keycloak) remains Open
