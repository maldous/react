# Playwright E2E Baseline Evidence

**Date:** 2026-05-28
**ADR references:** ADR-0025, ADR-ACT-0112, ADR-ACT-0114, ADR-ACT-0115

## Summary

Playwright E2E substrate established for the react platform. Proves browser → React SPA →
platform-api → browser roundtrip using deterministic fixture session actors.

## Configuration

- **Playwright version:** 1.52.0
- **Browser:** Chromium (headless)
- **Config file:** playwright.config.ts (repo root)
- **Test directory:** e2e/
- **API port:** 3001 (PLATFORM_API_PORT env var)
- **App port:** 5173 (APP_PORT env var)

## Service lifecycle

Playwright webServer config starts both services automatically:

1. **platform-api**: `node --loader apps/platform-api/loader.mjs apps/platform-api/src/server/http.ts`

   - Serves: /healthz, /readyz, /version, /api/session
   - Fixture session: LOCAL_FIXTURE_SESSION=tenant-admin
   - Health URL: `http://localhost:3001/healthz`
   - Timeout: 20s

2. **Vite dev server**: `cd apps/react-enterprise-app && npx vite --port 5173`

   - Proxies /api/\*, /healthz, /readyz, /version to platform-api
   - Health URL: `http://localhost:5173`
   - Timeout: 30s

## Fixture session mode

`LOCAL_FIXTURE_SESSION=tenant-admin` on platform-api enables fixture session mode.

The `getFixtureSession()` function in `apps/platform-api/src/server/session.ts` reads this env var
and returns a `SessionActor` with full tenant-admin permissions (organisation.read,
organisation.update, etc.).

Real Keycloak login is not required. Blocked until ADR-ACT-0110 is Done.

## E2E tests

Location: `e2e/substrate/smoke.test.ts`

### Test suite: platform-api health substrate (3 tests)

| Test | Route | Assertion |
| ---- | ----- | --------- |
| GET /healthz returns ok | /healthz | status=200, body.status="ok" |
| GET /version returns version metadata | /version | status=200, typeof version=string |
| GET /api/session returns tenant-admin fixture actor | /api/session | roles contains tenant-admin, permissions contains organisation.read |

### Test suite: React SPA substrate (5 tests)

| Test | Route | Assertion |
| ---- | ----- | --------- |
| index page loads | / | heading "Platform" visible |
| /auth/login renders sign in heading | /auth/login | heading "Sign in" visible |
| Vite proxy: /api/session proxies to platform-api | /api/session (via Vite proxy) | status=200, actor.roles contains tenant-admin |
| fixture session: tenant-admin can access /protected-test | /protected-test | data-testid="protected-content" visible |
| unauthenticated: 401 session redirects to /auth/login | /protected-test (with 401 intercept) | URL redirects to /auth/login |

Total E2E tests: 8

## Artifact locations (gitignored)

- `playwright-report/` — HTML test report
- `e2e-results/` — traces, videos, screenshots on failure

## Commands

```bash
# Run E2E tests (starts services automatically)
npm run test:e2e

# Run with UI mode (debug)
npm run test:e2e:ui

# Show last report
npm run test:e2e:report

# Via Makefile
make e2e-check
```

## Deferrals

- Real Keycloak OIDC login tests: blocked until ADR-ACT-0110
- Additional browsers (Firefox, WebKit): deferred until cross-browser parity required
- /readyz E2E test: deferred — requires live Postgres (available when compose is running)

## ADR compliance

- ADR-0025: Playwright is the E2E standard. MSW scoped to Vitest only.
- ADR-0024: Tier 1 gate established. Fixture session active.
- ADR-ACT-0112: E2E substrate gate implemented.
- ADR-ACT-0114: Local app/API runtime start scripts configured.
- ADR-ACT-0115: Fixture session mode implemented.
