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
