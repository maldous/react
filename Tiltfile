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

docker_compose('./compose.yaml')

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
# Optional Keycloak (manual trigger ? make compose-up-identity first)
# ---------------------------------------------------------------------------

local_resource(
  'identity-profile',
  cmd='make compose-up-identity',
  labels=['auth'],
  trigger_mode=TRIGGER_MODE_MANUAL,
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
