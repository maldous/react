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

os.environ['KC_HOSTNAME'] = 'http://dev.localhost/kc'

# project_name='react-dev' aligns Tilt with docker/compose-wrapper.sh (--project-name react-dev).
# Without this, Tilt uses compose.yaml's `name: react-platform`, which conflicts with the
# react-dev containers started by the local_resource entries (make compose-up-* ENV=dev).
# Both would try to bind the same ports → Tilt's docker_compose startup fails.
docker_compose('./compose.yaml', project_name='react-dev')

dc_resource('postgres',       labels=['infra'])
dc_resource('redis',          labels=['infra'])
dc_resource('clickhouse',     labels=['infra'],
  links=[link('http://localhost:8124/play', 'ClickHouse play')])
dc_resource('minio',          labels=['infra'],
  links=[link('http://localhost:9001', 'MinIO console')])
dc_resource('mailpit',        labels=['infra'],
  links=[link('http://localhost:8025', 'Mailpit UI')])
dc_resource('otel-collector', labels=['infra'])

# ---------------------------------------------------------------------------
# Identity (Keycloak) — auto-start on tilt up
# keycloak-provision (Terraform realm apply) runs after Keycloak is healthy.
# ---------------------------------------------------------------------------

local_resource(
  'identity',
  cmd='make compose-up-identity ENV=dev',
  labels=['auth'],
  links=[link('http://localhost:8090/kc', 'Keycloak admin')],
)

local_resource(
  'keycloak-provision',
  cmd='make keycloak-provision ENV=dev',
  labels=['auth'],
  resource_deps=['identity'],
)

# ---------------------------------------------------------------------------
# Quality (SonarQube)
# ---------------------------------------------------------------------------

local_resource(
  'quality',
  cmd='make compose-up-quality ENV=dev',
  labels=['quality'],
  links=[link('http://localhost:9064/sonar', 'SonarQube')],
)

# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------

local_resource(
  'sentry',
  cmd='make compose-up-sentry ENV=dev',
  labels=['observability'],
  links=[link('http://localhost:9060', 'Sentry')],
  # Sentry profile shares per-env postgres, redis, and clickhouse (ADR-0017).
  # Snuba migrations and sentry-web fail to start until these are healthy.
  resource_deps=['postgres', 'redis', 'clickhouse'],
)

# ---------------------------------------------------------------------------
# External mocks (WireMock)
# ---------------------------------------------------------------------------

local_resource(
  'external-mocks',
  cmd='make compose-up-external-mocks ENV=dev',
  labels=['mocks'],
  links=[link('http://localhost:8085/__admin', 'WireMock admin')],
)

# ---------------------------------------------------------------------------
# Observability (Grafana + Loki + Alloy)
# ---------------------------------------------------------------------------

local_resource(
  'observability',
  cmd='make compose-up-observability ENV=dev',
  labels=['observability'],
  links=[link('http://localhost:3200', 'Grafana')],
  resource_deps=['otel-collector'],
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
  serve_cmd='cd apps/react-enterprise-app && ../../node_modules/.bin/vite --port 5173',
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
