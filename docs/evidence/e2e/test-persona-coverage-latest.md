# E2E persona authorization coverage — test

Generated (ADR-ACT-0285 Phase 6). DO NOT EDIT — regenerate via `make e2e-persona-authz ENV=<stage> E2E_PERSONA=<id>`.

- Persona: `unauthenticated-visitor` (authMode unauthenticated)
- Result: **PASSED**
- Checks: 7 (0 failed)

## Checks (expected vs actual)

- ✅ forbidden-route `/admin` → expected denied (redirect/sign-in), got denied
- ✅ forbidden-route `/admin/members` → expected denied (redirect/sign-in), got denied
- ✅ forbidden-route `/admin/logs` → expected denied (redirect/sign-in), got denied
- ✅ forbidden-api `GET /api/admin/tenants` → expected 401/403, got 401
- ✅ forbidden-api `GET /api/auth/settings/providers` → expected 401/403, got 401
- ✅ expected-route `/` → expected loads (non-blank), got loads
- ✅ expected-route `/login` → expected loads (non-blank), got loads
