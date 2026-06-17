# E2E persona-matrix — test

Generated (ADR-ACT-0285 Phase 6 sub-project A). DO NOT EDIT — regenerate via `make e2e-persona-matrix ENV=<stage>`.

- Result: **PASSED**
- Personas: 4; checks: 42; failed: 0
- Real auth: creds present

## Persona outcomes

- unauthenticated-visitor (unauthenticated): RAN
- fixture-tenant-admin (fixture): RAN
- fixture-viewer (fixture): RAN
- fixture-no-membership (fixture): RAN

## Checks (failures first)

- ✅ [unauthenticated-visitor] forbidden-route `/admin` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [unauthenticated-visitor] forbidden-route `/admin/members` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [unauthenticated-visitor] forbidden-route `/admin/logs` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [unauthenticated-visitor] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 401
- ✅ [unauthenticated-visitor] forbidden-api `GET /api/auth/settings/providers` → expected 401/403, got 401
- ✅ [unauthenticated-visitor] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [unauthenticated-visitor] expected-route `/login` → expected loads + data APIs 2xx, got loads
- ✅ [unauthenticated-visitor] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `mailpit /mailpit/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `sonarqube /sonar/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `minio /minio/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `pgadmin /pgadmin/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `sentry /sentry/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `clickhouse /clickhouse/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [unauthenticated-visitor] clickthrough-forbidden `keycloak /kc/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-tenant-admin] forbidden-route `/admin/logs` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-tenant-admin] forbidden-route `/admin/events` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-tenant-admin] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 401
- ✅ [fixture-tenant-admin] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-tenant-admin] expected-route `/admin` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-tenant-admin] expected-route `/admin/members` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-tenant-admin] clickthrough-granted `keycloak /kc/` → expected tenant-host-scoped, got deferred to sub-project B (tenant FQDN); apex correctly denies
- ✅ [fixture-tenant-admin] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-tenant-admin] clickthrough-forbidden `sentry /sentry/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-tenant-admin] clickthrough-forbidden `sonarqube /sonar/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-tenant-admin] clickthrough-forbidden `pgadmin /pgadmin/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-tenant-admin] clickthrough-forbidden `minio /minio/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-tenant-admin] clickthrough-forbidden `clickhouse /clickhouse/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-viewer] forbidden-route `/admin` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-viewer] forbidden-route `/admin/members` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-viewer] forbidden-api `GET /api/auth/settings/providers` → expected 401/403, got 401
- ✅ [fixture-viewer] forbidden-api `PATCH /api/auth/settings/providers` → expected 401/403, got 401
- ✅ [fixture-viewer] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-viewer] clickthrough-forbidden `keycloak /kc/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-viewer] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-viewer] clickthrough-forbidden `sentry /sentry/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-no-membership] forbidden-route `/admin` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-no-membership] forbidden-route `/admin/members` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-no-membership] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 401
- ✅ [fixture-no-membership] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-no-membership] clickthrough-forbidden `keycloak /kc/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [fixture-no-membership] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 401
