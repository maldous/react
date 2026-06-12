# Service Clickthrough Policy

Action: ADR-ACT-0233 (Source ADR-0029, ADR-0030)
Date: 2026-06-12
Status: implemented + locally proven

## Scope delivered

A single policy module —
`apps/platform-api/src/usecases/service-clickthrough.ts` — is now the source of
truth for every operational/tool UI reachable through Caddy forward-auth. It
declares, per service: the forward-auth resource, the classification
(`global_only` / `tenant_scoped_safe` / `not_exposed`), the REAL isolation
invariant, and the expected Caddy apex/tenant paths.

- `forward-auth.ts` derives `SYSTEM_ADMIN_RESOURCES` / `TENANT_ADMIN_RESOURCES`
  from the policy and delegates `checkResourceAccess` to `decideServiceAccess`
  (one decision path for handler, tests, and proofs).
- A reconciliation unit gate (`tests/unit/service-clickthrough.test.ts`) parses
  `docker/caddy/Caddyfile` and asserts the forward-auth resources routed per
  vhost block exactly match the policy: apex routes = exposed services with an
  apex path; tenant routes = tenant-scoped-safe services only; the
  custom-domain catch-all (ADR-ACT-0232) exposes NO tool clickthroughs;
  not-exposed services appear nowhere.
- Landing-page tool links are permission-gated with the matching
  `platform.clickthrough.*` / `tenant.clickthrough.*` permissions — a
  tenant-admin now sees only Keycloak; forward-auth remains the enforcement
  point.

## Findings closed (from ADR-ACT-0230)

1. **Tenant Mailpit exposure (data-isolation hole).** The tenant vhost routed
   `/mailpit/*` to the SHARED Mailpit inbox with a comment claiming a
   "tenant-domain-filtered email view" that did not exist — any tenant-admin on
   their own slug could read every tenant's captured mail. Mailpit is now
   GLOBAL_ONLY; the tenant Caddy route is removed; live proof shows the tenant
   path serves the SPA fallback, not Mailpit.
2. **Sentry dead grant.** `admin:sentry` was tenant-scoped-safe in forward-auth
   but Caddy never routed a tenant `/sentry/*` path. Reclassified GLOBAL_ONLY
   to match reality.
3. **Misleading permissions removed.** `tenant.clickthrough.mailpit`,
   `tenant.clickthrough.sentry`, and `platform.clickthrough.wiremock` (WireMock
   is NOT_EXPOSED) removed from `@platform/contracts-auth` and the
   `@platform/domain-identity` role bundles. The off-vocabulary
   `platform.clickhouse` bundle entry corrected to
   `platform.clickthrough.clickhouse`; `platform.clickthrough.grafana` added so
   the Grafana link can be permission-gated like the others.

## Matrix (decided by the policy module; proven by the unit gate + proof)

| Service | Classification | Apex route | Tenant route | Isolation invariant |
| --- | --- | --- | --- | --- |
| Keycloak | tenant_scoped_safe | /kc/* | /kc/* | console requires Keycloak's OWN admin authn; realm endpoints public by design; platform gate additive |
| Mailpit | global_only | /mailpit/* | — (removed) | none per tenant — shared unfiltered inbox |
| Sentry | global_only | /sentry/* | — | shared instance, no per-tenant org proven |
| SonarQube | global_only | /sonar/* | — | no per-tenant projects |
| MinIO | global_only | /minio/* | — | all-bucket console |
| ClickHouse | global_only | /clickhouse/* | — | no tenant partitioning |
| LocalStack | global_only | /localstack/* | — | no tenant scope |
| pgAdmin | global_only | /pgadmin/* | — | raw SQL; GUC scoping unsafe |
| Grafana | global_only | /grafana/* | — | all tenants' logs visible |
| Tilt | global_only | — (direct :10350) | — | cannot be path-proxied |
| WireMock | not_exposed | — | — | dev-only; direct port; never linked |

Custom domains (catch-all vhost): NO tool clickthroughs — app + auth surface only.

## Tests run

`npm run test:platform-api` (631 pass — includes the new decision-matrix +
Caddyfile-reconciliation + permission-vocabulary gates),
`npm run test:frontend:run` (177 pass), `npm run tsc:check`, `make check`.

## Proof output (live, local)

`npm run proof:service-clickthrough-policy` — pure decision matrix all-green,
plus live web-profile checks (`make compose-up-web ENV=test`):

```text
PASS  live: apex /mailpit/ without session → 401 (forward-auth gate)
PASS  live: tenant host /mailpit/ is SPA fallback, NOT the Mailpit UI (route removed)
PASS  live: custom-domain catch-all /mailpit/ is SPA fallback (no tool routes)
PASS  live: apex /kc/realms/* reachable without session (public by design)
```

(The Keycloak upstream returned 502 in the identity-profile-less web run — the
check proves the route is not forward-auth-gated, which is its purpose; it does
not claim Keycloak health.)

## Known deferrals

- Tenant-scoped variants of Mailpit/Grafana/Sentry (filtered views, per-tenant
  orgs/dashboards) — deferred until real isolation exists; the policy table is
  where such a change must start.
- forward-auth has no support-mode branch: system-admin clickthrough on tenant
  hosts uses the system-admin grant, not audited support mode (documented
  limitation, unchanged).

## No-secret / no-fake-readiness guarantees

No secrets involved. The new capability row (`tenant_service_clickthrough`) is
`invariant-ready` — it describes the enforced policy, not service health.
Keycloak's 502 above is reported as-is.

## ACTION-REGISTER linkage

ADR-ACT-0233. See
`docs/evidence/platform/domain-identity-capability-permutation-review.md`
(ADR-ACT-0230, Matrix D) for the pre-change state.
