# Local development guide

All local developer tooling for the enterprise React platform.

## Quick start

```bash
# 1. Install dependencies
npm ci

# 2. Start Compose default services
make compose-up-default

# 3. Run database migrations and seed
make db-migrate
make seed-demo

# 4. Start dev servers
npm run api:start:admin    # platform-api on :3001
# In another terminal:
cd apps/react-enterprise-app && npx vite   # React SPA on :5173
```

Or with Tilt (all-in-one, requires Tilt installed ? [install ?](tilt-workflow.md)):

```bash
make compose-up-default
tilt up
```

## Services and profiles

[Compose services ?](compose-services.md)

| Profile            | Command                              | Services                                          |
| ------------------ | ------------------------------------ | ------------------------------------------------- |
| default            | `docker compose up -d`               | postgres, redis, clickhouse, minio, mailpit, otel |
| web                | `make compose-up-web`                | platform-api + React SPA on :80                   |
| identity           | `make compose-up-identity`           | Keycloak                                          |
| external-mocks     | `make compose-up-external-mocks`     | WireMock                                          |
| workflow-provider  | `make compose-up-workflow-provider`  | Windmill + worker + backing DB/Redis + Temporal   |
| pitr-provider      | `make compose-up-pitr-provider`      | pgBackRest PITR provider                          |
| antivirus-provider | `make compose-up-antivirus-provider` | ClamAV malware scanning                           |
| external-sonar     | `make sonar-up`                      | SonarQube (shared instance)                       |

## Tilt feedback loop

[Tilt workflow ?](tilt-workflow.md)

Single command for real-time dev feedback: `tilt up`

## Dev Container

[.devcontainer/ ?](../../.devcontainer/devcontainer.json)

Works with VS Code Dev Containers and GitHub Codespaces. Includes Node 25, Docker-in-Docker, GitHub CLI, and Playwright.
Tilt is installed automatically by `.devcontainer/post-create.sh` using a pinned version with checksum verification.

> `.env` and secrets are **not** created by the container ? copy `.env.example` to `.env` manually before starting services.

## External mocks

[compose-services.md ?](compose-services.md#wiremock-setup-external-mocks-profile)

For deterministic external HTTP API simulation:

```bash
make compose-up-external-mocks
curl http://localhost:8089/__admin/health
```

## Reset and demo data

[reset-and-fixtures.md ?](reset-and-fixtures.md)

```bash
make reset-local         # Destructive full database reset
make seed-demo           # Re-seed fixture actors (idempotent)
make db-shell            # psql into local Postgres
make redis-flush-local   # Clear local Redis sessions
```

## E2E modes

| Mode                  | Command              | Target                 |
| --------------------- | -------------------- | ---------------------- |
| Dev (fixture session) | `make e2e-dev`       | localhost:5173 + :3001 |
| Production build      | `make e2e-dev-build` | vite preview           |
| Live / real auth      | `make e2e-prod`      | aldous.info            |

## API contract

[docs/api/ ?](../api/README.md)

OpenAPI 3.1 for REST supplementary routes. GraphQL is the primary boundary (ADR-0013).

## Architecture checks

```bash
make check              # Fast quality gate (format + lint + tsc + audit + compose + arch)
npm run test:architecture   # All architecture, platform, and API tests
node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict
```

## Key ports

| Service             | Port | URL                                  |
| ------------------- | ---- | ------------------------------------ |
| platform-api        | 3001 | <http://localhost:3001/healthz>      |
| React SPA (dev)     | 5173 | <http://localhost:5173>              |
| React SPA (preview) | 4173 | <http://localhost:4173>              |
| Postgres            | 5433 | postgresql://localhost:5433/platform |
| Redis               | 6379 | redis://localhost:6379               |
| Mailpit             | 8025 | <http://localhost:8025>              |
| WireMock            | 8089 | <http://localhost:8089/__admin/>     |
| Keycloak            | 8080 | <http://localhost:8080>              |
| SonarQube           | 9064 | <http://localhost:9064/sonar>        |
