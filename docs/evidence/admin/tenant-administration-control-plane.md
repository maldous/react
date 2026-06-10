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

## Verification (2026-06-10)

All green:

- **Architecture / governance**: `node tools/architecture/orchestrator/src/index.mjs all --strict`
  passes (package metadata, import boundaries incl. the new `contracts-admin` rule, generated
  READMEs, i18n, frontend conventions — no feature `main`, no inline GraphQL, no raw `/api/graphql`).
- **Static**: `tsc:check` (app + api + packages), `lint`, `format:check` clean.
- **Backend**: `test:platform-api` — **329/329** pass, including 11 new `auth-provider-config`
  unit tests (storage parse, audit-first merge, invalid body, tenant gating of
  `resolveProviderHint`/`listEnabledProviders`).
- **Frontend**: `test:frontend:run` — **85/85** pass (+21 new): AdminLayout nav permission
  gating, and the Members / Authentication / Features sections (success, loading, error, empty,
  permission-gated tenantAdmin vs viewer, mutation + LiveRegion announce, `axe` no-violations).
- **Architecture suite**: `test:architecture` — **752/752** pass; OpenAPI drift green after
  documenting `GET`/`PATCH /api/auth/settings/providers` in `docs/api/openapi.json`.
- **Build**: `vite build` succeeds (3327 modules) — the `/admin` control plane bundles for
  production deployment.
- **Mobile**: AdminLayout is responsive by construction (sidebar on `lg`, scrollable nav row on
  small screens, safe-area utilities, real-anchor links, `DataTable` horizontal scroll); covered
  by the AdminLayout test.

### Not performed in this slice

Live logged-in `/admin` walkthrough on prod (CRUD round-trips against a seeded tenant-admin
session) — the section behaviours are covered end-to-end by the MSW integration tests above
(real hooks → typed clients → fetch → mocked BFF). A live pass needs a seeded tenant-admin
session on a tenant FQDN and is recommended as the next manual check.
