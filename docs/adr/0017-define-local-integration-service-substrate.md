# ADR-0017: Define local integration service substrate

## Status

Accepted

## Date

2026-05-27

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture — adapters own runtime integration)
- ADR-0002 (bounded contexts — adapter packages per service)
- ADR-0007 (repository layout)
- ADR-0016 (quality gate baseline — Compose gates are opt-in)
- ADR-ACT-0087 (implementation tracking)

## Context

The platform has adapter packages for PostgreSQL, Redis, ClickHouse, object storage (S3/MinIO), email (SMTP), observability (OpenTelemetry), auth (Keycloak), and error monitoring (Sentry). Before the first vertical slice (ADR-ACT-0008), these adapters need local integration services to validate their contracts.

Without a defined local service substrate:

- Adapter validation depends on external or CI-only services.
- Developer onboarding requires manual service installation.
- Service versions diverge across developer machines.
- Integration testing has no repeatable local surface.

The local substrate must remain opt-in — architecture, lint, and security gates must not require Docker Compose to run.

## Stakeholder concerns

- **Engineering:** Compose must be opt-in; a developer who only wants to run lint/ADR checks must not need Docker.
- **Security:** No real secrets committed. `.env.example` documents defaults; `.env` is gitignored.
- **Operations:** Services are fully profiled; starting only what is needed. Heavy services (Sentry, SonarQube, Keycloak) must not start by default.
- **Architecture:** Service names must map to adapter packages. Every service must have a healthcheck.

## Decision drivers

1. Adapters require local service counterparts for integration validation.
2. Compose must be profile-gated — heavy services are opt-in.
3. Architecture and quality gates must not depend on Compose.
4. Images must be pinned to stable tags. No `latest`.
5. No secrets in version control. `.env.example` only.
6. Service names must map to adapter package names for traceability.
7. Every service must declare a healthcheck for `depends_on: condition: service_healthy`.

## Options considered

### Option A: Manual installation instructions only

Document service installation steps; no Compose file.

Pros:

- No new files.

Cons:

- Version drift across developer machines.
- No healthcheck guarantees.
- Onboarding cost is high.

### Option B: Single flat docker-compose.yml (all services always on)

One file, all services, no profiles.

Pros:

- Simple.

Cons:

- Heavy services (Sentry, SonarQube, Keycloak) always start — wastes memory.
- Developers running only lint checks must still have Docker.

### Option C: Profile-gated Compose file (chosen)

`compose.yaml` with four profiles plus a zero-profile default tier.

Pros:

- Default tier (postgres, redis, clickhouse, minio, mailpit, otel-collector) is lightweight.
- Heavy services are profile-gated.
- CI validates syntax with `docker compose config`; no services start in CI.
- `.env.example` documents all required variables without committing secrets.

Cons:

- Requires discipline to keep profiles consistent as services are added.

## Decision

Use Docker Compose with profile-gated services.

### Profiles

| Profile     | Services                                                              | Adapter(s)                                                                                                              |
| ----------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| (default)   | postgres, redis, clickhouse, minio, mailpit, otel-collector           | adapters-postgres, adapters-redis, adapters-clickhouse, adapters-object-storage, adapters-brevo, adapters-opentelemetry |
| quality     | sonarqube, sonar-postgres                                             | code quality (report-only)                                                                                              |
| identity    | keycloak, keycloak-postgres                                           | adapters-keycloak                                                                                                       |
| cloud-mocks | localstack                                                            | adapters-object-storage (S3), queue testing                                                                             |
| sentry      | sentry-web, sentry-worker, sentry-cron, sentry-postgres, sentry-redis | adapters-sentry                                                                                                         |

### Image pinning

All images are pinned to explicit major.minor or stable release tags. `latest` is not used. Tags should be reviewed and updated before the first vertical slice ships.

### Secret management

All credentials use environment variable substitution with safe development defaults (e.g., `${POSTGRES_PASSWORD:-platformpassword}`). Real values go in `.env` (gitignored). `.env.example` is committed with placeholder or default values.

### Port assignments

| Service        | Host port(s)               | Note                                                   |
| -------------- | -------------------------- | ------------------------------------------------------ |
| postgres       | 5433                       | System postgresql disabled; port 5432 in use           |
| redis          | 6379                       | System redis-server disabled                           |
| clickhouse     | 8124 (HTTP), 9002 (native) | 8123 in use (homeassistant); 9000 conflicts with minio |
| minio          | 9000 (API), 9001 (console) |                                                        |
| mailpit        | 1025 (SMTP), 8025 (UI)     |                                                        |
| otel-collector | 4317 (gRPC), 4318 (HTTP)   |                                                        |
| sonarqube      | 9003                       | 9000 conflicts with minio                              |
| keycloak       | 8080                       |                                                        |
| localstack     | 4566                       |                                                        |
| sentry-web     | 9010                       | 9000 conflicts with minio                              |

### CI integration

CI runs `docker compose config` (syntax check only). No services are started in CI. Hard gates do not depend on Compose.

### Sonar profile note

The SonarQube instance in the `quality` profile supersedes the `/opt/sonar-scanner-7.3` installation for local development. `sonar-project.properties` is updated to target `http://localhost:9003`.

## Rationale

Option C is chosen because:

- Lightweight default services cover all current adapter packages without unnecessary memory overhead.
- Profile gating prevents heavy services from blocking developers who do not need them.
- CI syntax checking provides automated validation without service startup cost.
- Named volumes, pinned images, and healthchecks ensure reproducible behaviour.

## Consequences

**Positive:**

- All adapter packages have local service counterparts.
- Onboarding is a single `docker compose up -d`.
- Profile isolation prevents inadvertent service start.
- CI catches Compose syntax regressions without starting services.

**Negative:**

- Developers need Docker installed.
- Heavy profiles (Sentry, quality, identity) consume significant memory when active.

**Security / LocalStack:**

The `cloud-mocks` profile mounts the Docker socket (`/var/run/docker.sock`). This is a local-development security exception required for Lambda/ECS emulation in LocalStack. It is profile-gated, never starts by default, and must not run in CI unless separately reviewed and approved. Do not run the `cloud-mocks` profile on shared or multi-user hosts without evaluating the socket exposure risk.

**Neutral / operational:**

- `docker compose config` (default profile) and `docker compose config --profile quality --profile identity --profile cloud-mocks --profile sentry` (all-profiles) are added to the CI `quality-gates` job as syntax gates. No services start in CI.
- On the validation host, system `postgresql`, `redis-server`, and `mailhog` were stopped to free ports during evidence collection. This is a description of the validation environment, not a repository requirement. Developers may instead set `POSTGRES_PORT`, `REDIS_PORT`, etc. in `.env` to use non-conflicting host ports.
- Adding a new adapter package should be accompanied by a matching service in `compose.yaml`.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: Compose file authoring, ADR drafting
- Human review status: Reviewed by architecture owner
- Evidence checked: `docs/evidence/local-platform/compose-baseline.md`
- Validation required: `docker compose config` passes; default services start cleanly

## Validation / evidence

Evidence level: Medium

Evidence file: `docs/evidence/local-platform/compose-baseline.md`

## Impacted areas

- Architecture: Adapter packages now have documented local service counterparts.
- Operations: `compose.yaml`, `.env.example`, `docker/otel/` added.
- Security: No secrets in version control; `.env` gitignored.
- Delivery: CI updated with `docker compose config` step.
- Documentation: `docs/local-development/compose-services.md` added.

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-27

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0001: Hexagonal architecture — adapters own runtime integration
- ADR-0002: Bounded contexts
- ADR-0007: Repository artifact layout
- ADR-0016: Quality gate baseline
- `compose.yaml`
- `docs/local-development/compose-services.md`
- Docker Compose profiles: <https://docs.docker.com/compose/profiles/>

## Notes

**Sentry profile is experimental and for SDK smoke testing only.** The `sentry` profile provides a minimal single-image Sentry setup for testing `@platform/adapters-sentry` SDK connectivity. It is not a full self-hosted Sentry stack, does not replace external Sentry or Grafana Cloud, and must not be used as the primary observability target. The `sentry-worker` and `sentry-cron` services are included but unvalidated — they use process-only liveness rather than HTTP healthchecks. See ADR-ACT-0089 for validation tracking.

**Host port overrides.** All compose host ports are configurable via `.env` environment variables (e.g. `POSTGRES_PORT=5434`). The defaults in `compose.yaml` reflect the validation host environment and may conflict on other machines. Override in `.env` rather than editing `compose.yaml`.

**Distroless image healthcheck constraint:** The `otel/opentelemetry-collector-contrib` image is a distroless binary image with no shell, wget, or curl. The in-container healthcheck uses a process-liveness proxy (`/otelcol-contrib help`) rather than a readiness probe. The real readiness endpoint (health_check extension HTTP API) is externally accessible at host port 13133 for external monitoring. If a true readiness probe is required, switch to a base image that includes health probing tools, or add a sidecar.

Sentry self-hosted is included in the `sentry` profile. The Sentry `sentry:24.12.0` image handles DB initialisation via `sentry upgrade --noinput` on first start. Admin user creation requires a manual step: `docker exec -it react-platform-sentry-web-1 sentry createuser`.

The `SENTRY_SECRET_KEY` must be generated before starting the sentry profile. Generate with: `python3 -c "import secrets; print(secrets.token_hex(32))"`.
