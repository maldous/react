# Evidence: Tenant Administration Control Plane (ADR-0036 / ADR-0037)

Actions: ADR-ACT-0204 (control plane), ADR-ACT-0205 (per-tenant auth provider config).

This file collects verification evidence for the `/admin` control plane slice (shell + Members,
Authentication, Features) and per-tenant authentication provider configuration.

## Scope delivered

- Responsive `/admin` shell with permission-gated navigation (sidebar on `lg+`, scrollable nav on
  mobile), under the `_authenticated` layout, gated by `tenant.admin.access`.
- Sections: Members, Authentication (providers + IdPs + MFA + session), Features.
- `@platform/contracts-admin` zod contracts shared BFF ↔ SPA.
- Per-tenant provider config in `tenant_settings` (`auth.providers`) + `GET`/`PATCH
  /api/auth/settings/providers` + tenant-aware `GET /api/auth/providers` + `/auth/login` enablement guard.

## Verification

_To be completed during the verification step:_

- Gates: orchestrator `all --strict`, `tsc:check`, `lint`, `format:check`, `test:platform-api`,
  `test:frontend:run`, `test:architecture`, `make check`.
- Runtime: `/admin` and each section exercised on desktop and at 390px (Playwright), CRUD round-trips,
  permission gating (viewer ⇒ Forbidden), and per-tenant provider list reflected at login.
