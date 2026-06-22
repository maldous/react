# E2E persona-matrix — prod

Generated (ADR-ACT-0285 Phase 6 sub-project A). DO NOT EDIT — regenerate via `make e2e-persona-matrix ENV=<stage>`.

- Result: **PASSED**
- Personas: 13; checks: 71; failed: 0
- Real auth: creds present

## Persona outcomes

- unauthenticated-visitor (unauthenticated): RAN
- scaffold-system-admin (real): RAN
- scaffold-tenant-admin (real): RAN
- scaffold-tenant-manager (real): RAN
- scaffold-tenant-member (real): RAN
- scaffold-support-breakglass (real): RAN
- scaffold-disabled-user (real): RAN
- scaffold-expired-session (real): SKIPPED — no distinct Keycloak account in provisionRef
- scaffold-cross-tenant (real): RAN
- tenant-entitlement-disabled (real): SKIPPED — no distinct Keycloak account in provisionRef
- tenant-entitlement-enabled (real): SKIPPED — no distinct Keycloak account in provisionRef
- tenant-quota-limited (real): SKIPPED — no distinct Keycloak account in provisionRef
- tenant-rate-limited (real): SKIPPED — no distinct Keycloak account in provisionRef

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
- ✅ [scaffold-system-admin] session-roles `/api/session` → expected ["system-admin"], got ["system-admin"]
- ✅ [scaffold-system-admin] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-system-admin] expected-route `/admin` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-system-admin] expected-route `/admin/logs` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-system-admin] expected-route `/admin/clickthrough` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-system-admin] clickthrough-granted `keycloak /kc/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/kc/realms/master/protocol/openid-connect/auth?client_id=security-admin-console&redirect_uri=https%3A%2F%2Faldous.info%2Fkc%2Fadmin%2Fmaster%2Fconsole%2F&state=482b907b-b089-4661-9559-46a975921050&response_mode=query&response_type=code&scope=openid&nonce=aecd6548-f613-4acd-978b-df8e5fa7d0c1&code_challenge=9AoC5gyY6dI5i_iuov507Yrav8aoHh43pfyuT0eKNmE&code_challenge_method=S256>
- ✅ [scaffold-system-admin] clickthrough-granted `grafana /grafana/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/grafana/?orgId=1&from=now-6h&to=now&timezone=browser>
- ✅ [scaffold-system-admin] clickthrough-granted `mailpit /mailpit/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/mailpit/>
- ✅ [scaffold-system-admin] clickthrough-granted `sonarqube /sonar/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/sonar/>
- ✅ [scaffold-system-admin] clickthrough-granted `minio /minio/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/minio/>
- ✅ [scaffold-system-admin] clickthrough-granted `pgadmin /pgadmin/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/pgadmin/login?next=/pgadmin/>
- ✅ [scaffold-system-admin] clickthrough-granted `sentry /sentry/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/sentry/auth/login/>
- ✅ [scaffold-system-admin] clickthrough-granted `clickhouse /clickhouse/` → expected service UI (status<400, not SPA), got status=200 url=<https://aldous.info/clickhouse/>
- ✅ [scaffold-system-admin] clickthrough-granted-skipped `prometheus /prometheus/` → expected service unavailable on this stage, got status=502 url=<https://aldous.info/prometheus/>
- ✅ [scaffold-system-admin] clickthrough-granted-skipped `alertmanager /alertmanager/` → expected service unavailable on this stage, got status=502 url=<https://aldous.info/alertmanager/>
- ✅ [scaffold-system-admin] clickthrough-granted-skipped `windmill /windmill/` → expected service unavailable on this stage, got status=502 url=<https://aldous.info/windmill/>
- ✅ [scaffold-system-admin] clickthrough-granted-skipped `temporal /temporal/` → expected service unavailable on this stage, got status=502 url=<https://aldous.info/temporal/>
- ✅ [scaffold-tenant-admin] session-roles `/api/session` → expected ["tenant-admin"], got ["tenant-admin"]
- ✅ [scaffold-tenant-admin] forbidden-route `/admin/logs` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [scaffold-tenant-admin] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 403
- ✅ [scaffold-tenant-admin] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-tenant-admin] expected-route `/admin` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-tenant-admin] expected-route `/admin/members` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-tenant-admin] clickthrough-granted `keycloak /kc/` → expected tenant-host-scoped, got deferred to sub-project B (tenant FQDN); apex correctly denies
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `sentry /sentry/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `sonarqube /sonar/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `prometheus /prometheus/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `alertmanager /alertmanager/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `windmill /windmill/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-admin] clickthrough-forbidden `temporal /temporal/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-manager] session-roles `/api/session` → expected ["manager"], got ["manager"]
- ✅ [scaffold-tenant-manager] forbidden-route `/admin/auth` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [scaffold-tenant-manager] forbidden-route `/admin/config` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [scaffold-tenant-manager] forbidden-api `PATCH /api/auth/settings/providers` → expected 401/403, got 403
- ✅ [scaffold-tenant-manager] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-tenant-manager] clickthrough-forbidden `keycloak /kc/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-manager] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-member] session-roles `/api/session` → expected ["member"], got ["member"]
- ✅ [scaffold-tenant-member] forbidden-route `/admin/members` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [scaffold-tenant-member] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 403
- ✅ [scaffold-tenant-member] expected-route `/` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-tenant-member] expected-route `/admin` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-tenant-member] clickthrough-forbidden `keycloak /kc/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-tenant-member] clickthrough-forbidden `grafana /grafana/` → expected denied (401/403 or redirect-to-login), got 403
- ✅ [scaffold-support-breakglass] session-roles `/api/session` → expected ["system-admin"], got ["system-admin"]
- ✅ [scaffold-support-breakglass] expected-route `/admin` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-disabled-user] login-disabled `/api/session` → expected no session, got status=401 userId=none
- ✅ [scaffold-disabled-user] forbidden-route `/` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [scaffold-disabled-user] forbidden-route `/admin` → expected denied (redirect / sign-in / forbidden-state), got denied
- ✅ [scaffold-disabled-user] forbidden-api `GET /api/session` → expected 401/403, got 401
- ✅ [scaffold-disabled-user] forbidden-api `GET /api/admin/tenants` → expected 401/403, got 401
- ✅ [scaffold-disabled-user] expected-route `/login` → expected loads + data APIs 2xx, got loads
- ✅ [scaffold-disabled-user] clickthrough-forbidden `keycloak /kc/` → expected denied (401/403 or redirect-to-login), got 401
- ✅ [scaffold-cross-tenant] session-roles `/api/session` → expected ["tenant-admin"], got ["tenant-admin"]
- ✅ [scaffold-cross-tenant] forbidden-api `tenant-b:GET /api/organisation/profile` → expected 401/403, got 403
