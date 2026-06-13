# Provider environment classification

> Governing decision: **ADR-0056** (environment/service classification) and the
> deployment ladder. Enforced by `npm run proof:provider-environment-classification`
> (static; reads `universal-service-foundation-registry.json`). Companion to
> [`docs/architecture/environment-service-classification.md`](../../architecture/environment-service-classification.md).

## Rule (ADR-0056)

Tenant runtime data defaults to **per-environment**. `shared-cross-environment`
is allowed only when the service proves the full checklist: environment tagging,
tenant tagging (if tenant data exists), access control, retention, backup,
restore, deletion, audit, readiness proof, and a written leakage analysis. If any
item is missing, classify as per-environment. **Mocks are never production.**

Deployment ladder: **development** (resettable, local-free proof, mocks allowed
when marked) → **test** (destructive, resettable, mocks test-only) → **staging**
(data preserved, no mocks, no destructive multi-tenant tests) → **production**
(full isolation, no mocks, externalised secrets, honest readiness).

Allowed-environment legend: ✓ allowed · ✗ not allowed · — n/a.

## Classification matrix

| Provider | Compose profile | Capability | Classification | dev | test | staging | prod | Tenant data | Shared allowed? | Readiness proof | Backup / restore / deletion | Leakage analysis | Production blocker |
| --- | --- | --- | --- | :-: | :-: | :-: | :-: | --- | --- | --- | --- | --- | --- |
| Postgres | (default) | relational-storage | per-environment | ✓ | ✓ | ✓ | ✓ | yes | no | postgres probe | pg_dump/restore (`proof:backup-local`); per-env volume | schema-per-tenant + RLS; no cross-env share | none (PITR is a separate row) |
| Redis | (default) | platform-login, rate-limiting | per-environment | ✓ | ✓ | ✓ | ✓ | yes (sessions, counters) | no | `proof:rate-limits-redis` (PING) | per-env instance; counters self-expire (TTL) | tenant id is the leading key segment; no cross-tenant keys | none |
| MinIO | (default) | object-storage | per-environment | ✓ | ✓ | ✓ | ✓ | yes (objects) | no | `proof:tenant-storage` | per-env buckets; deletion per object/prefix | per-tenant prefix isolation probe | file CRUD/quotas/lifecycle not delivered |
| ClickHouse | (default) | metering-usage-meters (provider) | per-environment | ✓ | ✓ | ✓ | ✓ | yes (usage) | no | clickhouse probe | per-env instance | tenant-tagged; distinct from Sentry ClickHouse | high-volume provider is Phase 2.5 |
| Keycloak | identity | platform-login, idp-brokering | per-environment | ✓ | ✓ | ✓ | ✓ | yes (identities) | no | auth-credential readiness | per-env realm/volume | realm-per-env; no cross-env share | real-IdP login proof blocked |
| Loki / Grafana / Alloy | observability | logs, metrics-traces | per-environment | ✓ | ✓ | ✓ | ✓ | yes (tenant logs) | no | loki probe; `proof:tenant-observability` | per-env; prod needs S3 backend | label-based tenant/env scoping | Loki filesystem storage in prod |
| Meilisearch | search-provider | search-indexing | per-environment | ✓ | ✓ | ✓ | ✓ | yes (documents) | no | adapter readiness (Phase 4.5) | per-env indexes; resettable in dev/test | index-per-tenant (preferred) or hard tenant filter | **provider candidate / not integrated** — adapter + isolation proof required before delivered |
| Temporal | workflow-provider | workflow-engine-scheduled-jobs | per-environment | ✓ | ✓ | ✓ | ✓ | yes (workflow state) | no | namespace/client readiness (Phase 5.5) | per-env namespaces; engine DB per-env | namespace-per-env; no cross-env workflow state | **provider candidate / not integrated** — durable long-running orchestration |
| Windmill | workflow-provider | workflow-engine-scheduled-jobs | per-environment | ✓ | ✓ | ✓ | ✓ | yes (script/job state) | no | workspace readiness (Phase 5.5) | per-env workspaces | workspace-per-env | **provider candidate / not integrated** — scripts/admin automation/light jobs |
| Prometheus | observability-provider | metrics-traces | per-environment | ✓ | ✓ | ✓ | ✓ | yes (runtime metrics) | no (unless checklist) | scrape/ready probe (Phase 7.5) | per-env TSDB | env labels mandatory; tenant labels where tenant data exists | **provider candidate / not integrated** — backend behind OTEL collector |
| Tempo | observability-provider | metrics-traces (traces) | per-environment | ✓ | ✓ | ✓ | ✓ | yes (traces) | no (unless checklist) | ready probe (Phase 7.5) | per-env trace store | env/tenant labels; no secrets in spans | **provider candidate / not integrated** — trace ingest/query proof required |
| Alertmanager | observability-provider | alerting-incident-oncall | per-environment | ✓ | ✓ | ✓ | ✓ | no (routing config) | shared only w/ checklist | ready probe (Phase 7.5) | per-env config | env-scoped routing; must not page across environments | **provider candidate / not integrated** — alert routes/on-call not delivered |
| OpenBao | secrets | runtime-secrets | per-environment | ✓ | ✓ | ✓ | ✓ | yes (secrets) | no | `proof:secrets-openbao` (sys/health + live KV round-trip) | per-env KV path `<base>/<org>/<ref>`; revoke/delete | org-scoped ref (RLS) + per-tenant KV path; opaque `secret:<uuid>` | **delivered** behind `SecretStorePort` (built-in Postgres store is the durable default); local profile is OpenBao `-dev` mode — production needs sealed/HA/auto-unseal + externalised creds; UI is `not_exposed` |
| Mailpit | (default) | notifications (email transport) | local/test/staging proof only | ✓ | ✓ | ✓ | ✗ | no (dev sink) | no | `proof:email-sender` | n/a (sink) | local capture only; never customer mail | **not a production transport** — prod needs real SMTP/Brevo adapter |
| SonarQube | external-sonar | code-quality-secret-dep-scan | shared-cross-environment | ✓ | ✓ | ✓ | ✓ | no (engineering quality) | yes (checklist met) | sonarqube probe | single `react-sonar` project | engineering quality, not tenant runtime data — no tenant data to leak | dependency scan not yet a hard gate |
| Sentry | external-sentry | code-quality-secret-dep-scan | shared-cross-environment (errors only) | ✓ | ✓ | ✓ | ✓ | errors only (env/tenant tagged) | yes (checklist met) | sentry probe | 90-day retention | errors only, env/tenant tagged; **its internal Kafka/ClickHouse are Sentry-only and must never be reused as the platform bus/warehouse** | none for error telemetry |
| WireMock | external-mocks | mock-providers | mock-only / forbidden-in-production | ✓ | ✓ | ✗ | ✗ | no | no | service probe | n/a | no real data permitted | **forbidden-in-production** |
| LocalStack | cloud-mocks | mock-providers | mock-only / forbidden-in-production | ✓ | ✓ | ✗ | ✗ | no | no | service probe | n/a | AWS mock; `secretsmanager` is not the secrets capability | **forbidden-in-production** |
| mock-oidc | identity-mocks | mock-providers | mock-only / forbidden-in-production | ✓ | ✓ | ✗ | ✗ | no | no | service probe | n/a | OIDC fixture; cannot substitute for a real IdP | **forbidden-in-production** |

## Provider candidates added in this pass

These are documented as `provider candidate / not integrated / not production-ready`
— they have a classification and a delivery requirement, but no adapter, no
readiness proof against a live backend, and therefore **no delivered status**:
Meilisearch, Temporal, Windmill, Prometheus, Tempo, Alertmanager.

A provider is only promoted to delivered when it has a port-backed adapter, a live
readiness proof, tenant-isolation proof where it holds tenant data, and a registry
status change — never from compose availability alone.

## Delivered provider in this pass

- **Redis rate-limit counter** (`rate-limiting`, Phase 3.5, ADR-ACT-0263): a real
  adapter behind `RateLimitRepository`, live-proven (`proof:rate-limits-redis`),
  per-environment, tenant-isolated keys, honest Postgres fallback. See
  [`rate-limit-provider-foundation.md`](./rate-limit-provider-foundation.md).
- **OpenBao secret store** (`runtime-secrets`, Tier-1 kernel, ADR-ACT-0265): a real
  adapter behind `SecretStorePort` (built-in Postgres store is the durable default),
  live-proven (`proof:secrets-openbao` — live KV round-trip), per-environment,
  org-scoped ref + per-tenant KV path, opaque `secret:<uuid>`, value never returned.
  Local profile is OpenBao `-dev` mode (production needs sealed/HA/auto-unseal). See
  [`secrets-openbao-foundation.md`](./secrets-openbao-foundation.md).
