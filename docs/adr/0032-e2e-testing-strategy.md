# ADR-0032: E2E Testing Strategy

**Status:** Accepted

**Date:** 2026-05-29

---

## Context

The platform needs a consistent, maintainable E2E testing strategy that scales as features grow. Prior to this ADR, E2E tests were scattered across four directories (`e2e/substrate/`, `e2e/aldous/`, `e2e/real-auth/`, `e2e/prod/`) with four corresponding Playwright config files, making the structure hard to reason about and the Makefile gauntlet complex.

The core distinction that governs all E2E decisions is: **dev tests run on localhost with fixture sessions; prod tests run on aldous.info with real user auth**.

---

## Decision

### Directory structure

```
e2e/
  dev/    — all localhost tests (fixture sessions, no real Keycloak required)
  prod/   — all aldous.info tests (real user auth, no fixture sessions)
```

No other top-level directories under `e2e/`. Feature-specific tests live in one of these two directories depending on whether they use fixtures or real auth.

### Playwright config naming convention

```
playwright.config.ts          — dev smoke tests (Vite dev server + fixture session)
playwright.build.config.ts    — dev build tests (vite preview + fixture session)
playwright.prod.config.ts     — prod tests (aldous.info + real auth)
playwright.<feature>.config.ts — future feature-specific suites
```

Each config declares `testDir: ./e2e/dev` or `testDir: ./e2e/prod` and uses `testMatch` to scope to its test files. No config targets both directories.

### Dev tests (`e2e/dev/`)

- Use `LOCAL_FIXTURE_SESSION=tenant-admin` for deterministic actor state.
- Do not require Keycloak to be running.
- `smoke.test.ts` targets the Vite dev server (`localhost:5173`).
- `build.test.ts` targets a vite preview production bundle (`localhost:4173`).
- Additional feature test files follow the same fixture convention.

### Prod tests (`e2e/prod/`)

- No `LOCAL_FIXTURE_SESSION` — every test exercises the real auth flow.
- All tests must be able to skip gracefully if `PROD_BASE_URL` is not reachable.
- `smoke.test.ts` checks infrastructure health and SPA loading without auth.
- Auth-dependent tests (`login.spec.ts`, `logout.spec.ts`, etc.) require `KEYCLOAK_TEST_USERNAME` and `KEYCLOAK_TEST_PASSWORD` in the environment.

### Makefile targets

```
make e2e-dev       — Tier 3 in make all: runs e2e/dev/smoke.test.ts via playwright.config.ts
make e2e-dev-build — Tier 4 in make all: runs e2e/dev/build.test.ts via playwright.build.config.ts
make e2e-prod      — NOT in make all: runs e2e/prod/** against aldous.info
```

`make all` stops at `e2e-dev-build`. `make e2e-prod` is a separate step run after a real deployment.

### Feature-specific config pattern

When adding a new feature with dedicated E2E coverage that doesn't fit the smoke or auth test files:

1. Add test files to `e2e/dev/` (fixture) or `e2e/prod/` (real auth).
2. Optionally add `playwright.<feature>.config.ts` at the root pointing to the correct `testDir` with an appropriate `testMatch`.
3. Add a corresponding `make e2e-<feature>` target and wire it into `make all` at the correct tier.

---

## Consequences

- Two directories is the hard limit: `e2e/dev/` and `e2e/prod/`.
- Fixture tests must never call real external services (Keycloak, production APIs).
- Prod tests must never use `LOCAL_FIXTURE_SESSION`.
- Every playwright config must declare `testDir` and `testMatch` explicitly — no implicit glob over the full `e2e/` tree.
- `make all` always passes without Keycloak or a deployed production site.

---

## Related

- ADR-0022: BFF session boundary
- ADR-0025: Platform E2E substrate baseline
- ADR-0029: Multi-tenant isolation
- ADR-0030: Dynamic authorisation
- ACTION-REGISTER: ADR-ACT-0161 (see below)
