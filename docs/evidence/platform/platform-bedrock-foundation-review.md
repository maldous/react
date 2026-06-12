# Platform Bedrock Foundation Review (ADR-ACT-0227)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (review + synthesis), human-reviewed.

Purpose: a repository-wide review of the platform's local-service leverage, primitive
coverage, admin-UI surface, and proof ladder — to identify the highest-certainty missing
foundation pieces. **Honesty rule:** local-only proof is labelled local-only; anything
needing public DNS/TLS, real IdPs, real Cloudflare/AWS/Brevo is partial/deferred/blocked.

---

## 1. Local service inventory

Ports are dev defaults (env-var driven; test/staging/prod offset). "Console" = path via the
web-profile Caddy. "Proof" = the `proof:*` script(s) that exercise it.

| Service | Compose svc | Profile | Host port (env) | Internal URL | Console | Health | App usage | Admin UI | API readiness | Proof | Opportunity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Postgres | postgres | default | 5433 (`POSTGRES_PORT`) | postgres:5432 | /pgadmin | `pg_isready` | primary store (all tenant data) | via data | `/api/org/readiness` (indirect) | most proofs | service-readiness tile |
| Redis | redis | default | 6379 | redis:6379 | — | `PING` | session/PKCE store | no | no | no | ping probe + tile |
| ClickHouse | clickhouse | default | 8124 (`CLICKHOUSE_HTTP_PORT`) | clickhouse:8123 | /clickhouse | `/ping` | analytics (ADR-0015) | no | no | no | `/ping` probe + tile |
| MinIO | minio | default | 9000/9001 | minio:9000 | /minio | `/minio/health/live` | tenant storage (ADR-0049) | /admin/storage | `/api/org/storage/readiness` | proof:tenant-storage | tile + console link |
| Mailpit | mailpit | default | 1025/8025 | mailpit:8025 | /mailpit | `/mailpit/api/v1/info` | email sink (ADR-0047) | /admin/email | `/api/org/email-sender/readiness` | proof:email-sender | tile + console link |
| OTel collector | otel-collector | default | 4317/4318/13133 | otel-collector:4318 | — | `:13133/` | tracing export | /admin/observability | `/api/org/observability/readiness` | proof:tenant-observability | already a signal |
| pgAdmin | pgadmin | default | 5050 (`PGADMIN_PORT`) | pgadmin:80 | /pgadmin | `/pgadmin/misc/ping` | DB console | no | no | no | console link (operator) |
| Keycloak | keycloak | identity | 8090 (`KEYCLOAK_PORT`) | keycloak:8080/kc | /kc | `:9000/kc/health/ready` | auth/realms (ADR-0022) | /admin/auth | `/api/auth/settings/readiness` | proof:auth-* (4) | tile + console link |
| mock-oidc | mock-oidc | identity-mocks | 9080 (`MOCK_OIDC_PORT`) | mock-oidc:8080 | — | `/healthz` | brokered-login fixture | no | no | proof:auth-oidc-enterprise (indirect) | tile (local fixture) |
| LocalStack | localstack | cloud-mocks | 4566 | localstack:4566 | /localstack | `/_localstack/health` | cloud mocks | no | no | no | tile (not_configured by default) |
| WireMock | wiremock | external-mocks | 8089 (`WIREMOCK_PORT`) | wiremock:8080 | /wiremock | `/__admin/health` | external HTTP mocks | no | no | no | tile (dev-only) |
| SonarQube | sonarqube | external-sonar | 9064 (`SONAR_PORT`) | sonarqube:9000/sonar | /sonar | `/sonar/api/system/status` | code quality (CI) | no | no | no | tile + console link |
| Sentry (stack) | sentry-web + ~15 | external-sentry | 9060 (`/sentry`) | sentry-web:9000 | /sentry | `/api/0/` | error capture | /admin/observability (signal) | observability.errorCapture | proof:tenant-observability (DSN-gated) | tile (not_configured locally) |
| Loki | loki | observability | 3100 (`LOKI_PORT`) | loki:3100 | — | `/ready` | log search (ADR-0035) | /admin/logs, /admin/observability | observability.logIngestion | proof:tenant-observability | tile + readiness |
| Grafana | grafana | observability | 3200 (`GRAFANA_PORT`) | grafana:3000 | /grafana | `/api/health` | dashboards | /admin/observability (signal) | observability.dashboards | proof:tenant-observability | tile + console link |
| Alloy | alloy | observability | 12345 (`ALLOY_PORT`) | alloy:12345 | — | (none) | log shipping | no | no | no | tile (best-effort) |
| Caddy (web) | caddy/react-app | web | 80/`WEB_HTTP_PORT` | react-app:80 | / | `/healthz` | reverse proxy + SPA | n/a | n/a | proof:tenant-domains-routing | app-URL link |
| platform-api (web) | platform-api | web | 3001 (`PLATFORM_API_PORT`) | platform-api:3001 | /api | `/healthz` `/readyz` | BFF | n/a | `/healthz` `/readyz` | (all) | version/env tile |
| external-caddy | external-caddy | external-web | host :80 | (host net) | — | `/healthz` | edge routing | n/a | n/a | no | deferred (prod edge) |

**Default-up (running now):** postgres, redis, clickhouse, minio, mailpit, otel-collector,
pgadmin. **Profile-gated:** keycloak/mock-oidc (identity), loki/grafana/alloy
(observability), sonar/sentry/wiremock/localstack (external-*), caddy/web (web).

---

## 2. Platform primitive inventory

API = BFF route(s); UI = /admin surface; Rdy = in `/api/org/readiness`; Audit = audit
events; Proof = a `proof:*` script; Ev = evidence file.

| Primitive | API | UI | Rdy | Audit | Proof | Ev | No-secret | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tenant lifecycle | ✓ (admin provisioning) | partial (readiness only) | ✓ | ✓ | — | ✓ | ✓ | no sysadmin tenant-CRUD UI |
| user/member lifecycle | ✓ | ✓ /admin/members | ✓ | ✓ | — | ✓ | ✓ | no live member proof |
| group lifecycle | ✓ | ✓ /admin/members | partial | ✓ | — | ✓ | ✓ | thin UI |
| sub-organisation lifecycle | ✓ | partial | — | ✓ | — | ✓ | ✓ | no dedicated UI |
| auth provider lifecycle | ✓ | ✓ /admin/auth | ✓ | ✓ | proof:auth-settings | ✓ | ✓ | — |
| OIDC discovery/mapping | ✓ | ✓ /admin/auth | partial | ✓ | proof:auth-oidc-enterprise | ✓ | ✓ | mapping login-exercise **blocked (real IdPs)** |
| auth credential lifecycle | ✓ | partial (sysadmin) | ✓ | ✓ | proof:auth-credential-lifecycle | ✓ | ✓ | tenant self-service deferred |
| feature flag lifecycle | ✓ | ✓ /admin/features | invariant | ✓ | — | ✓ | ✓ | — |
| config lifecycle | ✓ | ✓ /admin/config | invariant | ✓ | — | ✓ | ✓ | — |
| branding lifecycle | ✓ (theme) | ✓ /admin/config | invariant | ✓ | — | partial | ✓ | thin |
| domain lifecycle | ✓ | ✓ /admin/domains | ✓ | ✓ | proof:tenant-domains(+routing) | ✓ | ✓ | public DNS/TLS **deferred** |
| storage lifecycle | ✓ | ✓ /admin/storage | ✓ | ✓ | proof:tenant-storage | ✓ | ✓ | IAM enforcement **deferred** |
| email lifecycle | ✓ | ✓ /admin/email | ✓ | ✓ | proof:email-sender | ✓ | ✓ | real Brevo **deferred** |
| observability lifecycle | ✓ | ✓ /admin/observability | ✓ | n/a | proof:tenant-observability | ✓ | ✓ | traces/metrics backends **not_applicable** |
| webhook lifecycle | ✓ | ✓ /admin/webhooks | ✓ | ✓ | proof:webhooks/-worker/-redrive | ✓ | ✓ | auto-redrive deferred |
| audit/log lifecycle | ✓ | ✓ /admin/logs | invariant | n/a | (logs in observability) | ✓ | ✓ | — |
| support-mode lifecycle | ✓ | partial | — | ✓ | (unit-tested) | partial | ✓ | no UI surface |
| **background worker lifecycle** | **—** | **—** | **—** | n/a | proof:webhook-worker | ✓ | ✓ | **no registry/heartbeat/UI** |
| **backup/restore lifecycle** | **—** | **—** | **—** | **—** | **—** | **—** | n/a | **entirely absent** |
| local environment lifecycle | (make) | — | — | n/a | — | partial | ✓ | not operator-visible |
| seed/demo fixture lifecycle | (make seed-demo) | — | — | n/a | — | — | ✓ | no proof, not visible |
| **service console lifecycle** | **—** | **—** | n/a | n/a | — | — | ✓ | **no console links anywhere** |
| **service readiness lifecycle** | **—** | **—** | partial | n/a | per-service | partial | ✓ | **no unified service-readiness API/UI** |
| proof/evidence lifecycle | n/a | **—** | n/a | n/a | (the ladder) | ✓ | ✓ | **proofs not discoverable in UI** |
| secret lifecycle | ✓ (encrypted, write-only) | n/a | n/a | ✓ | (per slice) | ✓ | ✓ | — |

---

## 3. Admin UI coverage inventory

**Present (13 routes):** index, readiness, members, auth, features, config, email, domains,
storage, observability, webhooks, logs (+ layout). All permission-gated, MSW-tested, axe-clean.

**Missing / thin:**

- **No platform/operations cockpit** — no single place showing service health, version,
  environment, console links, worker status, or the proof ladder.
- **No local-service console links** (Grafana/Mailpit/MinIO/pgAdmin/Keycloak/Sonar/…).
- **No service-status / readiness tiles** for infra services (only per-capability readiness).
- **No background-worker status** (the webhook worker runs invisibly).
- **No backup/restore visibility.** **No seed/demo fixture status.**
- **Proof/evidence not discoverable** from the UI.
- Thin: sub-organisations, support-mode, branding (no dedicated rich surfaces).

---

## 4. Proof ladder inventory

| Proof | Proves live | Services | Skips when | In UI? | Evidence |
| --- | --- | --- | --- | --- | --- |
| auth-settings | KC realm read/write (MFA/session) round-trip | keycloak | KC unreachable | no | auth-settings-readiness.md |
| auth-idps | IdP CRUD + secret redaction | keycloak | KC unreachable | no | writable-idp-…md |
| auth-credential-lifecycle | per-tenant svc-account cred lifecycle | keycloak | KC unreachable | no | auth-settings-credential-lifecycle.md |
| auth-oidc-enterprise | discovery/issuer/JWKS/callback/test | keycloak+mock-oidc | KC unreachable | no | oidc-enterprise-hardening.md |
| email-sender | SMTP send→Mailpit read-back | mailpit | Mailpit unreachable | no | tenant-email-sender-configuration.md |
| tenant-domains | challenge→verify→list→readiness (DB) | postgres | no org seeded | no | tenant-custom-domains.md |
| tenant-storage | live MinIO write/read/delete + isolation | minio | MinIO unreachable | no | tenant-storage-readiness.md |
| tenant-observability | Loki probe + Grafana/OTel signals | loki+grafana+otel | per-signal honest | no | tenant-observability-readiness.md |
| webhooks | signed dispatch→receiver→log | postgres | no org | no | webhooks/webhook-delivery-worker.md |
| webhook-worker | retry→dead-letter→fan-out | postgres | no org | no | webhook-delivery-worker.md |
| tenant-domains-routing | live Caddy FQDN→tenant context | web profile (test) | Caddy down | no | tenant-custom-domains.md |
| webhook-redrive | dead→redrive→deliver + metrics | postgres | Postgres down | no | webhook-redrive-metrics.md |

**Observation:** 12 green proofs, all honest-skip. **None are discoverable in the admin UI**,
and there is no unified "bedrock proof ladder" view. A `proof:platform-services` (unified
service readiness) is the missing capstone.

---

## Highest-certainty missing foundation (Phase 2 priorities)

1. **Service Readiness API + Operations Cockpit (A+B+C+D)** — a safe local-service registry
   with bounded health probes (`GET /api/org/platform/services/readiness`), a
   `/admin/platform` cockpit (version/env/role, service tiles, safe console links, worker
   status, proof-ladder index, capability partial/deferred summary), and a
   `proof:platform-services` runtime proof. **Highest certainty + highest leverage** — every
   service already has a health endpoint; this surfaces existing truth, fakes nothing.
2. **Background worker registry/heartbeat (C)** — minimal in-memory heartbeat for the
   webhook delivery worker, surfaced in the cockpit (documented as resetting on restart).
3. **Local backup/restore foundation (E)** — `scripts/backup/*` + guarded make targets +
   `proof:backup-local` (temp marker → dump → assert marker → cleanup). High certainty,
   local-only.
4. **README + CODEMAPS/infra alignment (G)** — the admin control-plane table is behind.
5. Demo/seed completeness (F) — `seed-demo` exists; enrichment is lower-certainty → deferred.

**Deferred/blocked (honest):** public DNS/TLS, real IdP OIDC login mapping, real
Cloudflare/AWS-IAM/Brevo/Sentry-DSN — all remain partial/deferred/blocked.

## ACTION-REGISTER linkage

ADR-ACT-0227 (this review). Implementation rows: ADR-ACT-0228 (cockpit + service readiness),
ADR-ACT-0229 (backup foundation) — added only for actually-delivered work.
