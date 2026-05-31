# ADR-0032: E2E Testing Strategy

## Status

Accepted — updated 2026-05-30 (internal/external split)

## Date

2026-05-29

---

## Context

The platform needs a consistent, maintainable E2E testing strategy that scales as features grow. Prior to this ADR, E2E tests were scattered across four directories (`e2e/substrate/`, `e2e/aldous/`, `e2e/real-auth/`, `e2e/prod/`) with four corresponding Playwright config files, making the structure hard to reason about and the Makefile gauntlet complex.

The core distinction that governs all E2E decisions is: **internal tests run with fixture sessions against local environments; external tests run with real user auth against deployed stacks**.

---

## Decision

### Directory structure

```text
e2e/
  internal/ ? all localhost tests (fixture sessions, no real Keycloak required)
  external/ ? all deployed-stack tests (real user auth, no fixture sessions)
  prod/     ? exhaustive production tests (non-functional: security, perf, contracts)
```

**Directory usage by environment (ADR-0034):**

| Tier       | Directory       | Environments  | Purpose                                                                           |
| ---------- | --------------- | ------------- | --------------------------------------------------------------------------------- |
| Internal   | `e2e/internal/` | Dev, Test     | Fixture-based functional tests ? smoke, build integrity                           |
| External   | `e2e/external/` | Staging, Prod | Real-auth deployed stack tests ? login, logout, auth, Caddy                       |
| Exhaustive | `e2e/prod/`     | Prod only     | Non-functional prod verification ? security headers, asset integrity, performance |

Feature-specific test files live in the appropriate tier directory depending on their auth model
and environment scope (ADR-0034).

### Playwright config naming convention

```text
playwright.internal.config.ts       ? internal smoke tests (Vite dev server + fixture session)
playwright.build.config.ts          ? internal build tests (vite preview + fixture session)
playwright.external.config.ts       ? external tests (real auth against PROD_BASE_URL)
playwright.<feature>.config.ts      ? future feature-specific suites
```

Each config declares `testDir: ./e2e/internal` or `testDir: ./e2e/external` and uses `testMatch` to scope to its test files. No config targets both directories.

### Internal tests (`e2e/internal/`)

- Use `LOCAL_FIXTURE_SESSION=tenant-admin` for deterministic actor state.
- Do not require Keycloak to be running.
- `smoke.test.ts` targets the Vite dev server (`localhost:5173`).
- `build.test.ts` targets a vite preview production bundle (`localhost:4173`).
- Additional feature test files follow the same fixture convention.
- Internal environments: dev, test.

### External tests (`e2e/external/`)

- No `LOCAL_FIXTURE_SESSION` ? every test exercises the real auth flow.
- All tests must be able to skip gracefully if `PROD_BASE_URL` is not reachable.
- `smoke.test.ts` checks infrastructure health and SPA loading without auth.
- Auth-dependent tests (`login.spec.ts`, `logout.spec.ts`, etc.) require `KEYCLOAK_TEST_USERNAME` and `KEYCLOAK_TEST_PASSWORD` in the environment.
- External environments: staging, production.

### Makefile targets

```bash
make e2e-internal           # runs e2e/internal/smoke.test.ts via playwright.internal.config.ts
make e2e-internal-build     # runs e2e/internal/build.test.ts via playwright.build.config.ts
make e2e-external           # runs e2e/external/** against PROD_BASE_URL
make e2e-external-smoke     # runs e2e/external/smoke.test.ts against PROD_BASE_URL
make e2e-external-auth      # runs e2e/external/auth tests against PROD_BASE_URL
```

`make all` is now a promotion pipeline that runs all 4 stages sequentially: dev (Tilt) ? test ? staging ? prod. Each stage runs the full test suite.

### Feature-specific config pattern

When adding a new feature with dedicated E2E coverage that doesn't fit the smoke or auth test files:

1. Add test files to `e2e/internal/` (fixture) or `e2e/external/` (real auth).
2. Optionally add `playwright.<feature>.config.ts` at the root pointing to the correct `testDir` with an appropriate `testMatch`.
3. Add a corresponding `make e2e-<feature>` target and wire it into `make all` at the correct tier.

---

## Consequences

- Two directories is the hard limit: `e2e/internal/` and `e2e/external/`.
- Fixture tests must never call real external services (Keycloak, production APIs).
- External tests must never use `LOCAL_FIXTURE_SESSION`.
- Every playwright config must declare `testDir` and `testMatch` explicitly ? no implicit glob over the full `e2e/` tree.
- `make all` runs the full promotion pipeline; individual stages can be run with `make stage-dev`, `make stage-test`, etc.

---

## Related

- ADR-0022: BFF session boundary
- ADR-0025: Platform E2E substrate baseline
- ADR-0029: Multi-tenant isolation
- ADR-0030: Dynamic authorisation
- ACTION-REGISTER: ADR-ACT-0161 (see below)
