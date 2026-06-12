# Platform Operations Cockpit — Service Readiness + Workers (ADR-ACT-0228)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.
Follows the ADR-ACT-0227 bedrock review (highest-certainty missing foundation).

## Scope delivered

A read-only operator cockpit surfacing existing local-service truth — nothing faked.

- **Service registry + readiness API** — `GET /api/org/platform/services/readiness`,
  tenant-scoped (FQDN/session), `tenant.platform.read`. A SAFE allowlist
  (`SERVICE_REGISTRY`, 15 services) with bounded health probes: Postgres `SELECT 1`,
  HTTP `GET health` for clickhouse/minio/mailpit/otel/loki/grafana/keycloak/mock-oidc/
  pgadmin/wiremock/localstack/sonarqube/web-caddy, Redis structural. Each HTTP probe is
  `AbortSignal.timeout(1500ms)` and they run in parallel, so a slow/down service cannot
  stall the page. Returns `environment`, `appVersion`, per-service
  `{key,labelKey,category,status,localOnly,consoleUrl,checkedAt,detailKey}`, and worker
  summaries.
- **Background worker registry** — in-memory heartbeat (`server/worker-registry.ts`); the
  webhook delivery worker records each tick (status + safe error). Surfaced with
  `inMemory: true` (resets on restart — documented, not hidden).
- **Operations cockpit UI** — `/admin/platform`: environment/version/tenant/roles header,
  service tiles (status + category + local-only badges + safe localhost console links),
  worker status, and a static proof-ladder index card. Permission-gated, i18n, MSW-tested,
  axe-clean.
- **Honest status vocabulary** — `healthy | configured | degraded | unreachable |
  not_configured | not_applicable | blocked | unknown`. A profile-gated service that is
  not running is `unreachable`; an unwired one is `not_configured` — never faked healthy.

## Decisions

- **No secrets/DSNs/raw env** ever leave the BFF — only the allowlisted, port-derived
  **localhost** console URLs, statuses, and timestamps. Console links are operator-only
  local URLs (never production).
- Service readiness is platform-global infra surfaced to the tenant-admin operator; it is
  a separate read permission (`tenant.platform.read`), not a tenant capability.
- The proof-ladder card is a **read-only index** (code chips) — it does NOT execute
  proofs (those run from the CLI). Local-only labelled.
- Worker heartbeat is in-memory by design (no new persistent store); the caveat is shown.

## Tests run (with proof layer)

- `node:test` (platform-api) — `platform-services.test.ts` (8): probe classification
  (postgres via pgProbe, http healthy/unreachable, redis structural), console URLs
  localhost-only/null + all local-only, worker status mapping (idle/stopped/unknown), and
  the assembled response carries no secret-ish keys.
- Vitest (frontend) — `AdminPlatformPage.test.tsx` (4): services + console link + worker
  render, proof-ladder index, error state, axe.
- OpenAPI drift: 93 routes match (1 new path). Full suites: `test:platform-api`,
  `test:frontend:run` 173.

## Runtime proof (executed)

`apps/platform-api/scripts/platform-services-runtime-proof.ts`
(`npm run proof:platform-services`) — probes the registry against the LIVE local stack.

```text
# Platform operations service-readiness runtime proof

  - postgres         healthy
  - redis            configured
  - clickhouse       healthy  (http://localhost:8124/play)
  - minio            healthy  (http://localhost:9001)
  - mailpit          healthy  (http://localhost:8025/mailpit)
  - otel_collector   healthy
  - loki             healthy
  - grafana          healthy  (http://localhost:3200)
  - keycloak         healthy  (http://localhost:8090/kc)
  - mock_oidc        healthy
  - pgadmin          healthy  (http://localhost:5050/pgadmin)
  - wiremock         healthy  (http://localhost:8085/__admin)
  - localstack       unreachable
  - sonarqube        healthy  (http://localhost:9064/sonar)
  - web_caddy        healthy  (http://localhost:8080)
PASS  postgres healthy (SELECT 1 via live pool)
PASS  ≥3 default-up services healthy (postgres/minio/mailpit/…) — healthy=13
PASS  every service has an honest status (no 'unknown')
PASS  environment + worker registry present
PASS  no secret/credential leaked in the payload
PASS  console URLs are localhost-only (or null)

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- **Live-proven (against the running local stack):** the service-readiness probes — 13
  services healthy, `localstack` honestly `unreachable` (its profile is not running),
  `redis` structurally `configured`; no secret in the payload; localhost-only consoles.
- Unit-proven (`node:test`): registry classification + worker mapping + no-secret guard.
- MSW-proven (frontend): the `/admin/platform` cockpit render/console-link/worker/error +
  axe.
- NOT a live signal: worker heartbeat in the standalone proof is null (no worker process);
  it is live in the running server where the worker ticks.

## Admin UI coverage

`/admin/platform` added to the admin nav (14 surfaces now). It surfaces service health,
worker status, env/version/role, safe console links, and the proof ladder — closing the
"no operations cockpit / no service-status / no worker-status / proofs-not-discoverable"
gaps from the bedrock review.

## Known deferrals

- A persistent worker heartbeat store (current is in-memory; resets on restart).
- Per-service deep diagnostics + history (this is point-in-time readiness).
- Sentry/LocalStack/Sonar show `not_configured`/`unreachable` until their profiles run.

## No-secret / no-leak guarantee

The endpoint returns only statuses, timestamps, and allowlisted localhost console URLs.
No credential, DSN, connection string, or raw env is read into the response — asserted in
`platform-services.test.ts` and the runtime proof ("no secret/credential leaked").

## No-fake-readiness guarantee

`healthy` requires a real probe response; down/unwired services are
`unreachable`/`not_configured`; everything is labelled `localOnly` — never implying
production readiness. Asserted by the unit test + the live proof.

## ACTION-REGISTER linkage

ADR-ACT-0228 (Source: ADR-ACT-0227 review). Evidence: this file.

---

## Hardening tranche (ADR-ACT-0235, 2026-06-12)

AI assistance: Claude (Fable 5), human-reviewed. Closes the review gaps on the
ADR-ACT-0227/0228/0229 tranche.

### Console visibility now follows the clickthrough policy

- New contract field `consoleAccess: tenant_safe | global_only | not_exposed`
  (`PlatformConsoleAccessSchema`), derived in `usecases/platform-services.ts` from the
  ADR-ACT-0233 policy module (`CLICKTHROUGH_SERVICES` — single source of truth;
  cockpit-only services fall back closed to `not_exposed`, `web_caddy` explicitly
  `global_only`).
- The BFF withholds global-only console URLs (pgAdmin, MinIO, Grafana, Mailpit,
  ClickHouse, SonarQube, web/Caddy) from non-system-admin viewers; `not_exposed`
  (WireMock — ADR-ACT-0233 "never linked") carries no URL for anyone; the tenant-safe
  Keycloak link remains. The UI renders "System operator only" in place of withheld
  global-only links.
- `tenant.platform.read` added to the system-admin bundle (the payload is
  platform-global infra); the route's FQDN scope was relaxed so a system-admin can read
  it from the apex — a non-system-admin without tenant context still gets 400.
- Tests: `platform-services.test.ts` proves tenant viewers never receive
  pgAdmin/MinIO/Grafana/Mailpit/ClickHouse/Sonar links, system-admin viewers do,
  WireMock never links, and registry classifications mirror the policy module.
  `AdminPlatformPage.test.tsx` proves the same at the UI layer (tenant-admin
  suppression + "System operator only"; Grafana/pgAdmin links on the system-admin
  fixture).

### Honest health semantics

- "Any HTTP response = healthy" removed. `httpProbe` now returns `{statusCode, body}`:
  non-2xx ⇒ `degraded`; no response ⇒ `unreachable`; 2xx + service-specific body check ⇒
  `healthy`. Body checks: Grafana `/api/health` `database` must be ok (else degraded);
  LocalStack `/_localstack/health` with any `error` service ⇒ degraded. Loki `/ready`,
  ClickHouse `/ping`, MinIO `/minio/health/live`, Mailpit info all require 2xx.
- Tests: 500/503 ⇒ degraded (never healthy), network error ⇒ unreachable, Grafana
  failing-database ⇒ degraded on 200, LocalStack failed service ⇒ degraded,
  unparseable 2xx body stays healthy.
- Live: the hardened proof classified `web_caddy` as `degraded` (a non-2xx responder on
  the configured port) — previously this would have read `healthy`.

### MSW fixture accuracy

The fixture mirrors the real `SERVICE_REGISTRY` (all 15 services, real categories and
console URLs; postgres no longer carries a Grafana console URL). Default fixture =
tenant-admin view (global-only links nulled); exported
`platformServicesReadinessSystemAdminFixture` = system-admin view used by the
console-link rendering test (Grafana).

### Proof-ladder registry

`PROOF_LADDER` in `@platform/contracts-admin` (`proof-registry.ts`) is the single
registry consumed by `/admin/platform` and referenced by the README;
`proof-registry.test.ts` reconciles it against `package.json` `proof:*` scripts (both
directions) and asserts every entry is mentioned in the README. `proof:backup-local` is
now in the ladder, the UI, and the README.

### Proof env loading

`proof:platform-services` resolves `POSTGRES_URL` **after** `loadLocalEnv()`, so
`ENV=test` probes the `.env.test` stack. It also live-proves the tenant-view console
gating (no global-only link in the tenant view; Keycloak retained).

### Backup hardening

- `postgres-backup.sh`: refuses any ENV outside dev|test unless explicit
  `ALLOW_BACKUP_ENV=<ENV>`; `umask 077` + `chmod 600` on the dump.
- `postgres-restore.sh`: `psql -v ON_ERROR_STOP=1 --single-transaction` (a failing
  statement aborts instead of half-overwriting); dev/test + `CONFIRM_RESTORE` guards
  unchanged.
- `proof:backup-local` (all PASS live): dump integrity + mode 600, backup refusal for
  ENV=prod without `ALLOW_BACKUP_ENV`, restore refusal for wrong env AND for missing
  `CONFIRM_RESTORE`, plus static checks for the psql safety flags and umask (labelled
  static — a live restore would overwrite the DB).

### Gates run (all green)

`tsc:check`, `test:platform-api` (645), `test:frontend:run` (179),
`test:architecture` (792), `openapi:drift` (99 routes), `frontend:conventions`,
`semgrep:gate`, `proof:platform-services` (live), `proof:backup-local` (live),
`make check`.

### ACTION-REGISTER linkage (hardening)

ADR-ACT-0235 (Source: ADR-0029/ADR-0030; depends on ADR-ACT-0228). Evidence: this
section.
