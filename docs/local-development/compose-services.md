# Local integration service substrate

Docker Compose provides local integration services for adapter validation and first vertical slice development. All services are opt-in; architecture, lint, and security gates do not require Compose.

## Quick start

```bash
# Start default services (postgres, redis, clickhouse, minio, mailpit, otel-collector)
docker compose up -d

# Stop all
docker compose down

# Logs
docker compose logs -f
```

## Profiles

| Profile        | Command                                      | Services                                                                                    |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| (default)      | `docker compose up -d`                       | postgres, redis, clickhouse, minio, mailpit, otel-collector                                 |
| web            | `docker compose --profile web up -d --build` | platform-api container + react-app (Caddy) on :80                                           |
| external-sonar | `make sonar-up`                              | sonarqube + sonar-postgres (shared instance)                                                |
| identity       | `npm run compose:identity`                   | keycloak + keycloak-postgres                                                                |
| cloud-mocks    | `npm run compose:cloud`                      | localstack                                                                                  |
| external-mocks | `npm run compose:external-mocks`             | wiremock                                                                                    |
| sentry         | `make sentry-up`                             | sentry-web + sentry-worker + sentry-cron + sentry-postgres + sentry-redis (shared instance) |

> **web profile note:** `SESSION_COOKIE_SECURE` must be `false` (the default in `.env.example`) when serving over `http://localhost:80`. Set it to `true` only when behind HTTPS (e.g. production or Cloudflare).
> Stop any system Caddy process before starting the web profile to free port 80.

## Services and ports

| Service        | Profile        | Host port(s)                                 | Package/adapter                                          |
| -------------- | -------------- | -------------------------------------------- | -------------------------------------------------------- |
| postgres       | default        | 5433                                         | `@platform/adapters-postgres`                            |
| redis          | default        | 6379                                         | `@platform/adapters-redis`                               |
| clickhouse     | default        | 8124 (HTTP), 9002 (native)                   | `@platform/adapters-clickhouse`                          |
| minio          | default        | 9000 (API), 9001 (console)                   | `@platform/adapters-object-storage`                      |
| mailpit        | default        | 1025 (SMTP), 8025 (UI)                       | `@platform/adapters-brevo` (SMTP transport)              |
| otel-collector | default        | 4317 (gRPC), 4318 (HTTP), 13133 (health API) | `@platform/adapters-opentelemetry`                       |
| sonarqube      | external-sonar | 9064                                         | code quality analysis (shared instance)                  |
| keycloak       | identity       | 8080                                         | `@platform/adapters-keycloak`                            |
| localstack     | cloud-mocks    | 4566                                         | `@platform/adapters-object-storage` (S3), queue testing  |
| sentry-web     | sentry         | 9010                                         | `@platform/adapters-sentry`                              |
| wiremock       | external-mocks | 8089                                         | external HTTP API simulation / adapter contract fixtures |

## Web UIs

| Service       | URL                           | Default credentials                   |
| ------------- | ----------------------------- | ------------------------------------- |
| MinIO console | <http://localhost:9001>       | minioadmin / miniopassword            |
| Mailpit       | <http://localhost:8025>       | (no auth)                             |
| SonarQube     | <http://localhost:9064/sonar> | admin / admin (change on first login) |
| Keycloak      | <http://localhost:8080>       | admin / admin                         |
| Sentry        | <http://localhost:9010>       | see setup below                       |
| LocalStack    | <http://localhost:4566>       | (no auth for S3/SQS)                  |
| WireMock      | <http://localhost:8089>       | admin UI: `/__admin/`                 |

## Configuration

Copy `.env.example` to `.env` and review each value:

```bash
cp .env.example .env
```

Do not commit `.env`. All credentials in `.env.example` are development defaults only.

## WireMock setup (external-mocks profile)

WireMock simulates external HTTP APIs with deterministic stub responses. Use it when developing or testing adapters that call external services.

```bash
npm run compose:external-mocks
# or: make compose-up-external-mocks

# Health check
curl http://localhost:${WIREMOCK_PORT:-8089}/__admin/health

# Verify example stub
curl http://localhost:${WIREMOCK_PORT:-8089}/__platform/mock/ping
# ? {"status":"ok"}

# WireMock admin UI
open http://localhost:${WIREMOCK_PORT:-8089}/__admin/
```

Committed mappings live in `docker/wiremock/mappings/`. Static response files live in `docker/wiremock/__files/`. Both directories are mounted read-only so container restarts do not modify source.

> **Security:** Mappings and `__files` must never contain real credentials, tokens, production API responses, or customer data. Safe fixtures only.

## SonarQube setup (shared instance)

Single SonarQube instance shared across all environments (like Sentry). Lives in its own compose project (`react-sonar`, profile `external-sonar`) with a dedicated postgres.

```bash
make sonar-up
# Wait for Sonar to start (1-2 minutes first run)
docker/compose-wrapper.sh sonar --profile external-sonar ps

# Configure analysis token:
# 1. Log in at http://localhost:9064/sonar with admin/admin
# 2. Change password when prompted
# 3. Go to Account / Security / Generate Token
# 4. Set SONAR_TOKEN=<token> in .env.sonar
make sonar
```

## Sentry setup (sentry profile ? experimental)

> **Experimental:** SDK smoke testing only. Not a full self-hosted Sentry stack. `sentry-worker` and `sentry-cron` are included but unvalidated. Do not depend on this profile for adapter validation until ADR-ACT-0089 is resolved.

```bash
make sentry-up
# Wait for sentry-web to run the upgrade (2?3 minutes first run)
docker compose --profile sentry ps

# Create admin user after upgrade completes:
docker exec -it react-platform-sentry-web-1 sentry createuser \
  --email admin@example.local --password admin --superuser

# Generate SENTRY_SECRET_KEY (required):
python3 -c "import secrets; print(secrets.token_hex(32))"
# Set SENTRY_SECRET_KEY=<output> in .env
```

## ClickHouse port note

ClickHouse native protocol (port 9000) conflicts with MinIO's API port (9000). The host mapping remaps ClickHouse native to port 9002:

- ClickHouse HTTP: `localhost:8124` (most client libraries use this)
- ClickHouse native: `localhost:9002`

## Port conflicts and overrides

Host ports are configurable via `.env`. Override any default to avoid conflicts with other services:

```bash
# .env ? override any defaults
POSTGRES_PORT=5434       # default: 5433
REDIS_PORT=6380          # default: 6379
CLICKHOUSE_HTTP_PORT=8125  # default: 8124
# ...see .env.example for all port vars
```

All port variables and defaults are documented in `.env.example`.

> **Validation host note:** During initial evidence collection, system `postgresql`, `redis-server`, and `mailhog` were stopped to free the default ports. This was a local environment choice, not a repository requirement. Use `.env` port overrides as the preferred conflict resolution approach.

## LocalStack Docker socket

> **Security:** The `cloud-mocks` profile mounts `/var/run/docker.sock` for LocalStack Lambda/ECS emulation. This is a local-dev exception ? profile-gated, never starts by default, and must not run in CI or on shared hosts without explicit approval.

## npm scripts

| Script                         | Action                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `npm run compose:config`       | Validate compose.yaml syntax (default profile)                          |
| `npm run compose:config:all`   | Validate compose.yaml syntax (all profiles, including shared instances) |
| `npm run compose:up:default`   | Start exactly the 6 default services                                    |
| `npm run compose:down:volumes` | Stop all services and remove volumes                                    |
| `npm run compose:up`           | Start default services                                                  |
| `npm run compose:down`         | Stop all services                                                       |
| `npm run compose:logs`         | Follow all service logs                                                 |
| `npm run compose:ps`           | Show service status                                                     |
| `make sonar-up`                | Start shared SonarQube instance                                         |
| `npm run compose:identity`     | Start Keycloak                                                          |
| `npm run compose:cloud`        | Start LocalStack                                                        |
| `make sentry-up`               | Start shared Sentry instance                                            |
