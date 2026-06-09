# Tiltfile ? Enterprise React Platform
# Scope: rapid dev container hot-reload only.
# Everything else (quality checks, tests, production builds) belongs in Make.
#
# ADR-0027: Tilt local development feedback loop
# ADR-0033: Dev environment uses .localhost TLD (auto-resolving, no /etc/hosts)
#
# LINKS
#   React dev:      http://localhost:5173
#   API health:     http://localhost:3001/healthz
#   Mailpit:        http://localhost:8025
#   Tilt UI:        http://localhost:10350

# ---------------------------------------------------------------------------
# Compose infra (default profile)
# ---------------------------------------------------------------------------

os.environ['KC_HOSTNAME'] = 'http://localhost:8090/kc'
os.environ['MINIO_BROWSER_REDIRECT_URL'] = 'http://localhost:9001'
# Sentry URL prefix — must include /sentry path so Sentry generates path-prefixed
# redirects (e.g. /sentry/auth/login/…) that route through Vite's proxy instead
# of bare /auth/login/… paths that collide with the platform-api /auth proxy.
os.environ['SENTRY_URL_PREFIX'] = 'http://localhost:5173/sentry'
# WireMock host port — matches WIREMOCK_PORT in .env.dev. Tilt's docker_compose()
# does not source .env.dev, so the compose.yaml default (8089) would otherwise apply.
# Required because wiremock is now a Tilt-managed dc_resource (see below) instead of
# a local_resource shell-out, which previously sourced .env.dev via compose-wrapper.sh.
os.environ['WIREMOCK_PORT'] = '8085'
# Alloy container discovery — match the Tilt-managed react-dev project.
os.environ['COMPOSE_PROJECT_FILTER'] = 'react-dev'

# project_name='react-dev' aligns Tilt with docker/compose-wrapper.sh (--project-name react-dev).
# Without this, Tilt uses compose.yaml's `name: react-platform`, which conflicts with the
# react-dev containers started by the local_resource entries (make compose-up-* ENV=dev).
# Both would try to bind the same ports → Tilt's docker_compose startup fails.
#
# profiles=['external-mocks', 'identity', 'observability'] activates the dev
# profile-gated services (WireMock, Keycloak, Grafana/Loki/Alloy) so Tilt owns
# their lifecycle via dc_resource. Sentry and SonarQube are NOT included — they
# live in separate react-sentry / react-sonar projects shared across all envs
# and are started via local_resource entries below (make sentry-up / sonar-up).
docker_compose('./compose.yaml', project_name='react-dev', profiles=['external-mocks', 'identity', 'identity-mocks', 'observability'])

dc_resource('postgres',       labels=['infra'])
dc_resource('redis',          labels=['infra'])
dc_resource('clickhouse',     labels=['infra'],
  links=[link('http://localhost:8124/play', 'ClickHouse play')])
dc_resource('minio',          labels=['infra'],
  links=[link('http://localhost:9001/', 'MinIO console')])
dc_resource('mailpit',        labels=['infra'],
  links=[link('http://localhost:8025/mailpit/', 'Mailpit UI')])
dc_resource('otel-collector', labels=['infra'])
dc_resource('pgadmin',        labels=['infra'],
  links=[link('http://localhost:5050/pgadmin/', 'pgAdmin')])


local_resource(
  'keycloak-provision',
  cmd='make keycloak-provision ENV=dev',
  labels=['auth'],
  resource_deps=['keycloak'],
)

# mock-oidc — NON-PRODUCTION upstream IdP fixture (ADR-ACT-0157), Tilt-managed
# compose service. Keycloak brokers it as mock-google/mock-azure/mock-apple.
dc_resource('mock-oidc', labels=['auth'],
  links=[link('http://localhost:9080/', 'mock-oidc')],
)

# Register the mock broker IdPs on the platform realm once Keycloak is provisioned
# and mock-oidc is up. Idempotent and safe to re-run.
local_resource(
  'seed-idps',
  cmd='make seed-idps ENV=dev',
  labels=['auth'],
  resource_deps=['keycloak-provision', 'mock-oidc'],
)


# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------

local_resource(
  'sentry',
  cmd='make sentry-up',
  labels=['observability'],
  links=[link('http://localhost:9060', 'Sentry')],
  # Sentry profile shares per-env postgres, redis, and clickhouse (ADR-0017).
  # Snuba migrations and sentry-web fail to start until these are healthy.
  resource_deps=['postgres', 'redis', 'clickhouse'],
)

# ---------------------------------------------------------------------------
# SonarQube — shared across all envs (react-sonar project, profile external-sonar)
# ---------------------------------------------------------------------------

local_resource(
  'sonar',
  cmd='make sonar-up',
  labels=['quality'],
  links=[link('http://localhost:9064/sonar', 'SonarQube')],
  # No resource_deps — sonar-postgres is dedicated, lives in react-sonar project.
)

# ---------------------------------------------------------------------------
# External mocks (WireMock) — Tilt-managed compose service.
# Previously a local_resource shelling out to `make compose-up-external-mocks ENV=dev`,
# which double-managed the wiremock container with Tilt's own compose awareness and
# caused host port 8085 to be held by Tilt while compose tried to bind 0.0.0.0:8085.
# As a dc_resource, Tilt owns the container lifecycle directly — no port conflict.
# ---------------------------------------------------------------------------

dc_resource('wiremock', labels=['mocks'])

# Profile-gated services — Tilt-managed via docker_compose() profiles above.
# Keycloak uses its own postgres (keycloak-postgres) and needs Terraform
# provisioning after healthy start.
dc_resource('keycloak-postgres', labels=['infra'])
dc_resource('keycloak', labels=['auth'],
  links=[link('http://localhost:8090/kc/admin/', 'Keycloak admin')],
  resource_deps=['keycloak-postgres'],
)

dc_resource('loki', labels=['observability'])
dc_resource('grafana', labels=['observability'],
  links=[link('http://localhost:3200/grafana/', 'Grafana')],
  resource_deps=['loki'],
)
dc_resource('alloy', labels=['observability'],
  resource_deps=['loki'],
)


# ---------------------------------------------------------------------------
# platform-api dev server ? hot-reload on source changes
# ---------------------------------------------------------------------------

local_resource(
  'platform-api',
  serve_cmd='npm run api:start:admin',
  readiness_probe=probe(
    http_get=http_get_action(port=3001, path='/healthz'),
    period_secs=5,
    failure_threshold=10,
    initial_delay_secs=3,
  ),
  labels=['app'],
  links=[
    link('http://localhost:3001/healthz',     'health'),
    link('http://localhost:3001/readyz',      'readiness'),
    link('http://localhost:3001/version',     'version'),
    link('http://localhost:3001/api/session', 'session'),
  ],
  resource_deps=['postgres', 'redis'],
  deps=[
    'apps/platform-api/src',
    'packages',
    'apps/platform-api/loader.mjs',
  ],
  env={'APEX_DOMAIN': 'dev.localhost'},
)

# ---------------------------------------------------------------------------
# React SPA dev server (Vite) ? hot-reload on source changes
# ---------------------------------------------------------------------------

local_resource(
  'react-app',
  # Source .env.dev so Vite's process.env has the right ports for admin-tool
  # proxies (SONAR_PORT, KEYCLOAK_PORT, GRAFANA_PORT, PGADMIN_PORT, etc.).
  # Mirrors docker/compose-wrapper.sh's `set -a; source .env.dev; set +a` pattern.
  serve_cmd='set -a && . ./.env.dev && set +a && cd apps/react-enterprise-app && ../../node_modules/.bin/vite --port 5173',
  readiness_probe=probe(
    http_get=http_get_action(port=5173, path='/'),
    period_secs=5,
    failure_threshold=20,
    initial_delay_secs=5,
  ),
  labels=['app'],
  links=[link('http://localhost:5173', 'React SPA')],
  resource_deps=['platform-api'],
  deps=[
    'apps/react-enterprise-app/src',
    'apps/react-enterprise-app/index.html',
    'apps/react-enterprise-app/vite.config.ts',
    'packages',
  ],
)
