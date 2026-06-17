# E2E persona-matrix — dev

Generated (ADR-ACT-0285 Phase 6 sub-project A). DO NOT EDIT — regenerate via `make e2e-persona-matrix ENV=<stage>`.

- Result: **FAILED**
- Personas: 1; checks: 13; failed: 3
- Real auth: DEGRADED (no creds)

## Persona outcomes

- fixture-tenant-admin (fixture): FAILED

## Checks (failures first)

- ❌ [fixture-tenant-admin] clickthrough-forbidden `sonarqube /sonar/` → expected denied (401/403 or redirect-to-login), got 400
- ❌ [fixture-tenant-admin] clickthrough-forbidden `minio /minio/` → expected denied (401/403 or redirect-to-login), got 200
- ❌ [fixture-tenant-admin] clickthrough-forbidden `clickhouse /clickhouse/` → expected denied (401/403 or redirect-to-login), got 200
- ✅ [fixture-tenant-admin] forbidden-route `/admin/logs` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-tenant-admin] forbidden-route `/admin/events` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [fixture-tenant-admin] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 403
- ✅ [fixture-tenant-admin] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-tenant-admin] expected-route `/admin` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-tenant-admin] expected-route `/admin/members` → expected loads + data APIs 2xx, got loads
- ✅ [fixture-tenant-admin] clickthrough-granted `keycloak /kc/` → expected tenant-host-scoped, got deferred to sub-project B (tenant FQDN); apex correctly denies
- ✅ [fixture-tenant-admin] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 302
- ✅ [fixture-tenant-admin] clickthrough-forbidden `sentry /sentry/` → expected denied (401/403 or redirect-to-login), got 302
- ✅ [fixture-tenant-admin] clickthrough-forbidden `pgadmin /pgadmin/` → expected denied (401/403 or redirect-to-login), got 302
