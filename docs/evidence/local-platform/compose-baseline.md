# Compose integration substrate baseline evidence

## Summary

Docker Compose integration substrate hardened before the first vertical slice (ADR-ACT-0087, ADR-ACT-0088). Profile-gated services provide local counterparts for all adapter packages. Architecture, lint, and security gates do not require Compose to run.

## Governance

- ADR-0017 (accepted)
- ADR-ACT-0087 (Done ? initial substrate)
- ADR-ACT-0088 (Done ? healthchecks, tsconfig/docker artifact links)
- ADR-ACT-0089 (Open ? Sentry profile validation)
- ADR-ACT-0090 (Open ? license scanner)
- Hardened: 2026-05-27

## Services

### Default profile (no profile selector)

| Service | Image | Host port(s) | Status | Adapter | Port env var |
| --- | --- | --- | --- | --- | --- |
| postgres | postgres:16.6-alpine | `${POSTGRES_PORT:-5433}`:5432 | healthy | adapters-postgres | `POSTGRES_PORT` |
| redis | redis:7.4.2-alpine | `${REDIS_PORT:-6379}`:6379 | healthy | adapters-redis | `REDIS_PORT` |
| clickhouse | clickhouse/clickhouse-server:24.12 | `${CLICKHOUSE_HTTP_PORT:-8124}`:8123, `${CLICKHOUSE_NATIVE_PORT:-9002}`:9000 | healthy | adapters-clickhouse | `CLICKHOUSE_HTTP_PORT`, `CLICKHOUSE_NATIVE_PORT` |
| minio | minio/minio:RELEASE.2024-12-18T13-15-44Z | `${MINIO_API_PORT:-9000}`:9000, `${MINIO_CONSOLE_PORT:-9001}`:9001 | healthy | adapters-object-storage | `MINIO_API_PORT`, `MINIO_CONSOLE_PORT` |
| mailpit | axllent/mailpit:v1.21.0 | `${MAILPIT_SMTP_PORT:-1025}`:1025, `${MAILPIT_UI_PORT:-8025}`:8025 | healthy | adapters-brevo (SMTP) | `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT` |
| otel-collector | otel/opentelemetry-collector-contrib:0.114.0 | `${OTEL_GRPC_PORT:-4317}`:4317, `${OTEL_HTTP_PORT:-4318}`:4318, `${OTEL_HEALTH_PORT:-13133}`:13133 | healthy | adapters-opentelemetry | `OTEL_GRPC_PORT`, `OTEL_HTTP_PORT` |

### Profiled services

| Profile | Services | Port env var |
| --- | --- | --- |
| quality | sonarqube, sonar-postgres | `SONAR_PORT` (default 9003) |
| identity | keycloak, keycloak-postgres | `KEYCLOAK_PORT` (default 8080) |
| cloud-mocks | localstack | `LOCALSTACK_PORT` (default 4566) |
| sentry (experimental) | sentry-web, sentry-worker, sentry-cron, sentry-postgres, sentry-redis | `SENTRY_PORT` (default 9010) |

## Validation commands run and results

```text
npm run compose:config           ? valid (default profile)
npm run compose:config:all       ? valid (all profiles: quality, identity, cloud-mocks, sentry)
docker compose up -d (default)   ? 6 services started, all healthy within 20s
docker compose ps                ? all 6 (healthy)
docker compose down              ? clean shutdown
npm run format:check             ? All matched files use Prettier code style!
npm run lint:md                  ? 52 files, 0 errors
npm run lint                     ? 0 problems
npm run audit:deps               ? 0 vulnerabilities
npm run audit:osv                ? all lock files, 0 issues
node orchestrator all --strict   ? 6/6 passed
node --test (6 test files)       ? 6 pass, 0 fail
```

## Port remappings and overrides

All host ports are configurable via `.env` environment variables. Defaults reflect the initial validation host where certain ports were occupied:

- `POSTGRES_PORT=5433` ? default 5433 (5432 occupied by another running container on validation host)
- `CLICKHOUSE_HTTP_PORT=8124` ? default 8124 (8123 occupied by homeassistant container on validation host)

Developers on machines without these conflicts may set `POSTGRES_PORT=5432` etc. in `.env`.

## System service disabling ? validation environment note

On the initial validation host, system `postgresql`, `redis-server`, and `mailhog` were stopped to free the default ports. This is a description of the validation environment, not a repository requirement. The preferred approach for port conflicts is to override host ports in `.env`.

## Security note ? LocalStack Docker socket

The `cloud-mocks` profile mounts `/var/run/docker.sock` for LocalStack Lambda/ECS emulation. This is a local-dev exception:

- Profile-gated ? never starts by default
- Must not run in CI unless separately reviewed and approved
- Must not run on shared or multi-user hosts without evaluating the socket exposure risk

## Sentry profile ? experimental status

The `sentry` profile is for SDK smoke testing of `@platform/adapters-sentry` connectivity only:

- Not a full self-hosted Sentry stack
- Does not replace external Sentry or Grafana Cloud observability
- `sentry-worker` and `sentry-cron` are included but unvalidated ? no HTTP healthchecks, process-only liveness
- Adapter validation must not depend on this profile until ADR-ACT-0089 is resolved

## otel-collector healthcheck ? distroless constraint

`otel/opentelemetry-collector-contrib:0.114.0` is a distroless image with no shell, wget, or curl. The in-container healthcheck uses a process-liveness proxy (`/otelcol-contrib help`). The real readiness endpoint (health_check extension HTTP API) is externally accessible at `localhost:${OTEL_HEALTH_PORT:-13133}`.

## SonarQube (quality profile) ? scan executed

- Docker Compose quality profile started: sonarqube + sonar-postgres
- SonarQube healthy at <http://localhost:9003>
- Token generated locally via API (not committed)
- Scan executed: `npm run sonar:clean`
- Quality gate: **OK** ? zero bugs, vulnerabilities, hotspots, code smells
- 49 issues fixed in tools/architecture/ before clean scan achieved
- See: docs/evidence/quality-gates/enterprise-quality-gate-baseline.md

## What is deferred

| Item | Status | Tracking |
| --- | --- | --- |
| Sentry profile validation / replacement | Open | ADR-ACT-0089 |
| License policy automated scanning | Open | ADR-ACT-0090 |
| Knip/depcruise/Sonar hard-gate promotion | Open | Post-first-slice |
| Compose smoke tests in CI | Deferred | Requires live services ? ADR-0017 |
