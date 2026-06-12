# Infrastructure Codemap

**Last Updated:** 2026-06-07

Docker Compose services, profiles, ports, and Caddy virtual hosts for local development and multi-tenant routing.

> **Universal Service Foundation:** for the forward-looking plan that turns this infrastructure into a multipurpose software-provider substrate (what to build vs compose, per-environment vs shared, and the honest capability status of each domain), see [`docs/evidence/platform/universal-service-foundation-matrix.md`](../evidence/platform/universal-service-foundation-matrix.md) (ADR-ACT-0237, ADR-0053–ADR-0066) and the companion architecture docs under `docs/architecture/universal-service-foundation.md`.

## Default Profile Services

Started by `docker compose up -d` (no profile selector):

| Service        | Port                                     | Purpose                              | Health Check          |
| -------------- | ---------------------------------------- | ------------------------------------ | --------------------- |
| postgres       | 5433                                     | Transactional data (PostgreSQL 16)   | pg_isready            |
| redis          | 6379                                     | Cache, session store, queue          | redis-cli ping        |
| clickhouse     | 8124 (HTTP), 9002 (native)               | Analytical events, logs              | curl /ping            |
| minio          | 9000 (API), 9001 (console)               | Object storage (S3-compatible)       | MinIO health          |
| mailpit        | 1025 (SMTP), 8025 (UI)                   | Email capture & delivery (local dev) | HTTP health           |
| otel-collector | 4317 (gRPC), 4318 (HTTP), 13133 (health) | OpenTelemetry collector              | otel-collector health |
| pgadmin        | 5050                                     | PostgreSQL admin UI                  | HTTP health           |

## Optional Profiles

Activated via `docker compose --profile <name> up`:

### quality

| Service            | Port            | Purpose                                          |
| ------------------ | --------------- | ------------------------------------------------ |
| sonarqube          | 9003            | Code quality, coverage analysis (SonarQube 10.x) |
| sonarqube-postgres | 5432 (internal) | SonarQube database                               |

### identity

| Service           | Port            | Purpose                                       |
| ----------------- | --------------- | --------------------------------------------- |
| keycloak          | 8090            | OIDC/SAML identity provider (realm: platform) |
| keycloak-postgres | 5432 (internal) | Keycloak database                             |

### cloud-mocks

| Service    | Port | Purpose                                   |
| ---------- | ---- | ----------------------------------------- |
| localstack | 4566 | AWS service mocks (S3, Lambda, SQS, etc.) |

### external-mocks

| Service  | Port | Purpose                                          |
| -------- | ---- | ------------------------------------------------ |
| wiremock | 8089 | Deterministic HTTP API mocks (WireMock admin UI) |

### sentry (external-sentry profile)

Full Sentry 26.5.2 error tracking stack (errors-only, no performance):

| Service                                 | Port            | Purpose                     |
| --------------------------------------- | --------------- | --------------------------- |
| sentry-web                              | (via Caddy)     | Sentry UI                   |
| sentry-postgres                         | 5432 (internal) | Sentry database             |
| sentry-redis                            | 6379 (internal) | Sentry cache/queue          |
| sentry-clickhouse                       | 8123 (internal) | Sentry event storage        |
| sentry-kafka                            | 9092 (internal) | Event queue                 |
| sentry-relay                            | 3000 (internal) | Sentry relay (error intake) |
| sentry-snuba-\*                         | (internal)      | Analytics backend           |
| sentry-taskworker, sentry-taskscheduler | (internal)      | Background jobs             |

### Observability Stack (alloy, loki, grafana, sentry-bridge)

Metrics/logs aggregation (emerging infrastructure):

| Service | Port        | Purpose                                 |
| ------- | ----------- | --------------------------------------- |
| alloy   | 4317 (gRPC) | Observability collector (Grafana Alloy) |
| loki    | 3100        | Log aggregation (Grafana Loki)          |
| grafana | 3000        | Metrics & log visualization             |

### web

Full application stack (Caddy + platform-api + react-app):

| Service        | Port            | Purpose                                             |
| -------------- | --------------- | --------------------------------------------------- |
| platform-api   | 3001 (internal) | BFF API server                                      |
| react-app      | 5173 (internal) | React SPA dev server (Vite)                         |
| external-caddy | 80              | TLS termination & routing (Cloudflare edge in prod) |

---

## Caddy Virtual Hosts & Routing

Configured in `docker/caddy/Caddyfile`. Requires `make compose-up-web`.

### Super-Global Admin (aldous.info)

| Host        | Route                       | Destination          | Auth         |
| ----------- | --------------------------- | -------------------- | ------------ |
| aldous.info | /                           | react-enterprise-app | forward_auth |
| aldous.info | /api/\*                     | platform-api:3001    | forward_auth |
| aldous.info | /healthz, /readyz, /version | platform-api:3001    | — (public)   |
| aldous.info | /kc                         | keycloak:8090        | forward_auth |
| aldous.info | /mailpit                    | mailpit:8025         | forward_auth |
| aldous.info | /minio                      | minio:9001           | forward_auth |
| aldous.info | /sonar                      | sonarqube:9003       | forward_auth |
| aldous.info | /sentry                     | sentry-web:9000      | forward_auth |
| aldous.info | /wiremock                   | wiremock:8089        | forward_auth |
| aldous.info | /clickhouse                 | clickhouse:8123      | forward_auth |

### Per-Tenant App (\*.aldous.info)

FQDN-based routing (ADR-0029):

| Host Pattern       | Route    | Destination          | Notes                                   |
| ------------------ | -------- | -------------------- | --------------------------------------- |
| {slug}.aldous.info | /        | react-enterprise-app | App shell (tenant context in subdomain) |
| {slug}.aldous.info | /api/\*  | platform-api:3001    | BFF (tenant extracted from Host header) |
| {slug}.aldous.info | /kc      | keycloak:8090        | Realm: platform (shared Keycloak)       |
| {slug}.aldous.info | /mailpit | mailpit:8025         | Tenant-scoped email view                |
| {slug}.aldous.info | /sentry  | sentry-web:9000      | Tenant-scoped errors                    |

---

## Port Map (Environment Override)

All ports configurable via `.env`:

````text
POSTGRES_PORT=5433                REDIS_PORT=6379
CLICKHOUSE_HTTP_PORT=8124         CLICKHOUSE_NATIVE_PORT=9002
MINIO_API_PORT=9000               MINIO_CONSOLE_PORT=9001
MAILPIT_SMTP_PORT=1025            MAILPIT_UI_PORT=8025
OTEL_GRPC_PORT=4317               OTEL_HTTP_PORT=4318
OTEL_HEALTH_PORT=13133            SONAR_PORT=9003
KEYCLOAK_PORT=8090                LOCALSTACK_PORT=4566
WIREMOCK_PORT=8089                WEB_HTTP_PORT=80
PGADMIN_PORT=5050
```text
---

## Compose Commands

```bash
# Default (postgres, redis, clickhouse, minio, mailpit, otel-collector, pgadmin)
make compose-up-default

# With identity provider
make compose-up-identity

# With external mocks
make compose-up-external-mocks

# Full web stack (with Caddy routing)
make compose-up-web

# All profiles together
make compose-up-all

# Check current services
make compose-ps

# View logs
docker compose logs --tail=120 <service>

# Validate config
npm run compose:config
npm run compose:config:all
```text
---

## Forward Auth (ADR-0022, ADR-0030)

All `/mailpit`, `/sonar`, `/minio`, `/sentry`, `/wiremock`, `/kc` routes on Caddy enforce:

```text
forward_auth platform-api:3001 /internal/auth/forward
```text
- Sends `Cookie` header to platform-api
- platform-api returns 200 (allow), 401 (no session), or 403 (forbidden)
- Checks: session presence, user identity, tenant membership, UMA resource policies

**Security Header**: `X-Internal-Secret` (set `CADDY_INTERNAL_SECRET` in `.env`, validated by platform-api)

---

## Constraints

- TLS termination: Cloudflare in production, Caddy in local dev
- Trusted proxies: Cloudflare IP ranges + private/loopback in `docker/caddy/Caddyfile`
- RLS (Row-Level Security): Enabled on PostgreSQL; pgAdmin roles are non-superuser (RLS applies)
- Multi-tenancy: Keycloak realm=platform (shared); tenant isolation at database/row level
````
