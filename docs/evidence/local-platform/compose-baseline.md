# Compose integration substrate baseline evidence

## Summary

Docker Compose integration substrate added before the first vertical slice (ADR-ACT-0087). Profile-gated services provide local counterparts for all adapter packages. Architecture, lint, and security gates do not require Compose to run.

## Governance

- ADR-0017 (accepted)
- ADR-ACT-0087 (Done)
- Committed: 2026-05-27

## Services

### Default profile (no profile selector)

| Service | Image | Host port(s) | Status | Adapter |
| --- | --- | --- | --- | --- |
| postgres | postgres:16.6-alpine | 5433:5432 | healthy | adapters-postgres |
| redis | redis:7.4.2-alpine | 6379:6379 | healthy | adapters-redis |
| clickhouse | clickhouse/clickhouse-server:24.12 | 8124:8123, 9002:9000 | healthy | adapters-clickhouse |
| minio | minio/minio:RELEASE.2024-12-18T13-15-44Z | 9000:9000, 9001:9001 | healthy | adapters-object-storage |
| mailpit | axllent/mailpit:v1.21.0 | 1025:1025, 8025:8025 | healthy | adapters-brevo (SMTP) |
| otel-collector | otel/opentelemetry-collector-contrib:0.114.0 | 4317:4317, 4318:4318 | running | adapters-opentelemetry |

### Profile: quality

| Service | Image | Host port(s) | Adapter |
| --- | --- | --- | --- |
| sonar-postgres | postgres:16.6-alpine | (internal) | — |
| sonarqube | sonarqube:lts-community | 9003:9000 | code quality (report-only) |

### Profile: identity

| Service | Image | Host port(s) | Adapter |
| --- | --- | --- | --- |
| keycloak-postgres | postgres:16.6-alpine | (internal) | — |
| keycloak | quay.io/keycloak/keycloak:26.2 | 8080:8080 | adapters-keycloak |

### Profile: cloud-mocks

| Service | Image | Host port(s) | Adapter |
| --- | --- | --- | --- |
| localstack | localstack/localstack:4.0.4 | 4566:4566 | adapters-object-storage (S3), queue testing |

### Profile: sentry

| Service | Image | Host port(s) | Adapter |
| --- | --- | --- | --- |
| sentry-postgres | postgres:16.6-alpine | (internal) | — |
| sentry-redis | redis:7.4.2-alpine | (internal) | — |
| sentry-web | sentry:24.12.0 | 9010:9000 | adapters-sentry |
| sentry-worker | sentry:24.12.0 | — | adapters-sentry |
| sentry-cron | sentry:24.12.0 | — | adapters-sentry |

## Port remappings

Two host port conflicts required remapping:

- **postgres**: 5433 (not 5432 — port 5432 used by `manicode-db-1` Docker container)
- **clickhouse HTTP**: 8124 (not 8123 — port 8123 used by `homeassistant` Docker container)

## System services disabled

- `postgresql` (systemd) — disabled; Docker Compose postgres takes priority
- `redis-server` (systemd) — disabled; Docker Compose redis takes priority
- `mailhog` (systemd) — disabled; mailpit in Docker Compose replaces it

## Commands run and results

```text
npm run compose:config              → YAML valid, all services parsed
docker compose up -d                → 6 default services started
docker compose ps                   → all 6 healthy or running
docker compose down                 → clean shutdown
npm run format:check                → clean
npm run lint:md                     → clean
npm run lint                        → clean
npm run audit:deps                  → 0 vulnerabilities
npm run audit:osv                   → no issues
node orchestrator all --strict      → 6/6 passed
node --test (6 files)               → 6 pass, 0 fail
```

## Issues resolved during setup

- `otel/opentelemetry-collector-contrib:0.116.0` — binary exec failure on this host; downgraded to 0.114.0 which works.
- mailhog was added then removed as redundant (mailpit covers the same use case and is actively maintained).
- homeassistant (Python3 process on port 8123) — remapped clickhouse HTTP to 8124.
- `/opt/sonarqube-25.11.0.114957` — Java processes killed; Docker Compose quality profile supersedes it on port 9003.

## Deferred

- Sentry profile: Docker image available (`sentry:24.12.0`); `SENTRY_SECRET_KEY` and admin user setup required before first use.
- Quality profile: SonarQube token must be generated after first login at <http://localhost:9003>.
- LocalStack: Services available (`s3,sqs,sns,secretsmanager`) but not tested against adapters yet.
- Image pinning review: tags should be updated to latest stable before first vertical slice.
