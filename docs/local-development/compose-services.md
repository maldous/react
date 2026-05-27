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

| Profile     | Command                    | Services                                                                  |
| ----------- | -------------------------- | ------------------------------------------------------------------------- |
| (default)   | `docker compose up -d`     | postgres, redis, clickhouse, minio, mailpit, otel-collector               |
| quality     | `npm run compose:quality`  | sonarqube + sonar-postgres                                                |
| identity    | `npm run compose:identity` | keycloak + keycloak-postgres                                              |
| cloud-mocks | `npm run compose:cloud`    | localstack                                                                |
| sentry      | `npm run compose:sentry`   | sentry-web + sentry-worker + sentry-cron + sentry-postgres + sentry-redis |

## Services and ports

| Service        | Profile     | Host port(s)               | Package/adapter                                         |
| -------------- | ----------- | -------------------------- | ------------------------------------------------------- |
| postgres       | default     | 5433                       | `@platform/adapters-postgres`                           |
| redis          | default     | 6379                       | `@platform/adapters-redis`                              |
| clickhouse     | default     | 8124 (HTTP), 9002 (native) | `@platform/adapters-clickhouse`                         |
| minio          | default     | 9000 (API), 9001 (console) | `@platform/adapters-object-storage`                     |
| mailpit        | default     | 1025 (SMTP), 8025 (UI)     | `@platform/adapters-brevo` (SMTP transport)             |
| otel-collector | default     | 4317 (gRPC), 4318 (HTTP)   | `@platform/adapters-opentelemetry`                      |
| sonarqube      | quality     | 9003                       | code quality analysis                                   |
| keycloak       | identity    | 8080                       | `@platform/adapters-keycloak`                           |
| localstack     | cloud-mocks | 4566                       | `@platform/adapters-object-storage` (S3), queue testing |
| sentry-web     | sentry      | 9010                       | `@platform/adapters-sentry`                             |

## Web UIs

| Service       | URL                     | Default credentials                   |
| ------------- | ----------------------- | ------------------------------------- |
| MinIO console | <http://localhost:9001> | minioadmin / miniopassword            |
| Mailpit       | <http://localhost:8025> | (no auth)                             |
| SonarQube     | <http://localhost:9003> | admin / admin (change on first login) |
| Keycloak      | <http://localhost:8080> | admin / admin                         |
| Sentry        | <http://localhost:9010> | see setup below                       |
| LocalStack    | <http://localhost:4566> | (no auth for S3/SQS)                  |

## Configuration

Copy `.env.example` to `.env` and review each value:

```bash
cp .env.example .env
```

Do not commit `.env`. All credentials in `.env.example` are development defaults only.

## SonarQube setup (quality profile)

```bash
npm run compose:quality
# Wait for Sonar to start (1–2 minutes first run)
docker compose --profile quality ps

# Configure sonar-project.properties token:
# 1. Log in at http://localhost:9003 with admin/admin
# 2. Change password when prompted
# 3. Go to Account → Security → Generate Token
# 4. Set SONAR_TOKEN=<token> in .env
npm run sonar:scan
```

## Sentry setup (sentry profile)

```bash
npm run compose:sentry
# Wait for sentry-web to run the upgrade (2–3 minutes first run)
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

## System service conflicts

System-level `postgresql` and `redis-server` services have been disabled.

Port remappings due to other running Docker containers:

- postgres: host port **5433** (5432 used by manicode-db-1)
- clickhouse HTTP: host port **8124** (8123 used by homeassistant container) If you need to re-enable them:

```bash
sudo systemctl enable --now postgresql redis-server
```

## npm scripts

| Script                     | Action                                             |
| -------------------------- | -------------------------------------------------- |
| `npm run compose:config`   | Validate compose.yaml syntax (no services started) |
| `npm run compose:up`       | Start default services                             |
| `npm run compose:down`     | Stop all services                                  |
| `npm run compose:logs`     | Follow all service logs                            |
| `npm run compose:ps`       | Show service status                                |
| `npm run compose:quality`  | Start SonarQube                                    |
| `npm run compose:identity` | Start Keycloak                                     |
| `npm run compose:cloud`    | Start LocalStack                                   |
| `npm run compose:sentry`   | Start Sentry                                       |
