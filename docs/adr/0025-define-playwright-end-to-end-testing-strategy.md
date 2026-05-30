# ADR-0025: Define Playwright end-to-end testing strategy

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead.

## Consulted

- Engineering team
- Product owner
- Security reviewer

## Context

ADR-0019 ratified Vitest and React Testing Library with MSW as the frontend component and hook
testing stack.

That decision deliberately deferred end-to-end browser testing. As ADR-ACT-0008 (first vertical
slice) approaches, the platform needs an E2E standard to prove the full browser ? React ? BFF/API
? DB ? browser roundtrip.

Without an E2E standard, slice validation relies on unit and integration tests that mock the
server layer. MSW is excellent for component tests but it cannot prove that the real server
correctly handles a request. E2E tests close that gap.

The decision must also address the identity challenge: real SSO login (Keycloak) is not yet
provisioned (blocked on ADR-ACT-0110). E2E tests must be able to run before real login exists.

## Stakeholder concerns

- Engineering:
  - E2E tests must not require Keycloak to run.
  - E2E tests must start services automatically rather than requiring manual service management.
  - Test failures must produce enough diagnostic output (trace, video, screenshot) to diagnose
    root causes without re-running locally.
  - E2E artifacts (traces, videos, screenshots, reports) must not be committed to the repository.

- Product:
  - Critical user flows must have at least one E2E test once introduced.

- Accessibility:
  - E2E accessibility checks should use Playwright's built-in accessibility matchers where
    practical.

- Security:
  - E2E tests must not contain hardcoded credentials or production secrets.
  - Fixture session actors (not real tokens) are used until ADR-ACT-0110 is complete.

## Decision drivers

- Prove the full browser-to-DB roundtrip in CI.
- Decouple E2E tests from live Keycloak until ADR-ACT-0110.
- Keep MSW for component and hook tests (Vitest scope).
- Produce actionable failure diagnostics.
- Automate service lifecycle within the E2E run.

## Options considered

### Option A: Cypress

Pros: Mature, good dashboard product, widely known.

Cons: Slower than Playwright, different API model, weaker multi-browser support for this use case,
requires separate server management configuration, higher overhead for a TypeScript-first monorepo.

### Option B: Puppeteer

Pros: Direct Chrome DevTools Protocol access, low-level control.

Cons: No first-class test runner, requires significant scaffolding for retry, reporter, and
parallel test support. Not a full testing framework.

### Option C: Playwright

Pros: First-class TypeScript support, built-in webServer config for automatic service lifecycle,
multi-browser support, trace/video/screenshot on failure, accessibility matchers, parallel test
support, actively maintained by Microsoft.

Cons: Newer than Cypress, requires browser binary installation.

## Decision

Use Playwright as the browser E2E standard.

### Scope

Playwright owns browser E2E tests: the full browser ? React SPA ? BFF/API ? DB ? browser
roundtrip.

Vitest (with React Testing Library and MSW) owns component tests and hook tests. MSW must not be
used in Playwright E2E tests.

### Fixture session mode

Until ADR-ACT-0110 (Keycloak provisioning) is Done, Playwright E2E tests must use deterministic
fixture session actors.

The LOCAL_FIXTURE_SESSION environment variable on the platform-api HTTP server controls which
fixture actor is active. Playwright webServer config sets this variable when starting platform-api.

Playwright E2E tests must not require live Keycloak before ADR-ACT-0110 is Done.

When ADR-ACT-0110 is Done, E2E login tests will use real OIDC flows. Fixture session mode will
remain available for non-auth-related slice tests.

### Service lifecycle

Playwright webServer config starts platform-api and the Vite dev server automatically.
E2E tests do not require manual service management.

The webServer reuseExistingServer option allows developers to start services manually for debugging.

### Failure diagnostics

Every E2E test run retains on failure:

- Playwright trace (trace: "retain-on-failure")
- Screenshot (screenshot: "only-on-failure")
- Video (video: "retain-on-failure")

### Artifact locations (gitignored)

- playwright-report/ ? HTML test report
- e2e-results/ ? test output artifacts (traces, videos, screenshots)

These directories are gitignored. They are never committed.

### Test location

E2E tests live under e2e/ at the repo root.

Playwright config lives at playwright.config.ts at the repo root.

### Critical user flows

Once a user flow is introduced to the application, at least one Playwright E2E test must cover
that flow. This is a hard rule, not advisory.

### Accessibility

Playwright's built-in accessibility matchers (toHaveAccessibleName, toHaveRole, etc.) must be
used where practical in E2E tests. Full accessibility audits remain in Vitest using vitest-axe.

### Browser targets

Chromium is the primary E2E browser. Additional browsers may be added when cross-browser parity
becomes a product requirement.

### CI integration

E2E tests run in CI as part of the pre-slice gate (make pre-slice-gate, make e2e-check).
CI uses a single worker (workers: 1) and retries once on failure (retries: 1).

### Package

@playwright/test is a devDependency in the root package.json. Browser binaries are installed
via: npx playwright install chromium --with-deps

## Consequences

- ADR-ACT-0112: Create Playwright E2E substrate gate. Install @playwright/test, create
  playwright.config.ts, create platform-api HTTP server, add Vite proxy, create first E2E smoke
  tests, add make e2e-check target.
- ADR-ACT-0114: Create local app/API runtime start scripts for E2E.
- ADR-ACT-0115: Create E2E fixture session mode for deterministic actors.
- MSW remains scoped to Vitest component/hook tests. MSW is never used in Playwright tests.
- All critical user flows introduced in ADR-ACT-0008 must have at least one Playwright test.
- E2E failure diagnostics are retained in playwright-report/ and e2e-results/ (gitignored).

## References

- ADR-0019: React component platform and frontend integration stack
- ADR-0024: Slice readiness and dependency gate model
- ADR-ACT-0008: Authenticated organisation profile slice
- ADR-ACT-0097: Frontend test harness (Vitest/RTL/MSW)
- ADR-ACT-0107: Protected route and API guard primitives
- ADR-ACT-0110: Keycloak Terraform/OpenTofu provisioning baseline
- ADR-ACT-0111: Local platform substrate smoke gate
- e2e/ (E2E test directory)
- playwright.config.ts
