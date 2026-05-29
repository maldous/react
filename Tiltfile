# Tiltfile — Enterprise React Platform
# ADR-0027: Tilt local development feedback loop
#
# MODES
#   Fast dev (default):   tilt up
#   Production parity:    see ADR-ACT-0128 (not yet implemented)
#
# PROFILES
#   Default infra starts automatically via docker_compose()
#   Keycloak:        make compose-up-identity before tilt up
#   WireMock:        make compose-up-external-mocks before tilt up
#
# LINKS
#   React dev:     http://localhost:5173
#   API health:    http://localhost:3001/healthz
#   API readiness: http://localhost:3001/readyz
#   Mailpit:       http://localhost:8025
#   Tilt UI:       http://localhost:10350

# ---------------------------------------------------------------------------
# Compose infra (default profile)
# ---------------------------------------------------------------------------

docker_compose('./compose.yaml')

dc_resource('postgres',       labels=['infra'])
dc_resource('redis',          labels=['infra'])
dc_resource('clickhouse',     labels=['infra'])
dc_resource('minio',          labels=['infra'],
  links=[link('http://localhost:9001', 'MinIO console')])
dc_resource('mailpit',        labels=['infra'],
  links=[link('http://localhost:8025', 'Mailpit UI')])
dc_resource('otel-collector', labels=['infra'])

# ---------------------------------------------------------------------------
# platform-api dev server
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
)

# ---------------------------------------------------------------------------
# React SPA dev server (Vite)
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

# ---------------------------------------------------------------------------
# Quality checks — auto-trigger
# ---------------------------------------------------------------------------

local_resource(
  'typecheck',
  cmd='npm run tsc:check',
  labels=['quality'],
  deps=[
    'apps',
    'packages',
    'tsconfig.base.json',
  ],
)

local_resource(
  'lint',
  cmd='npm run lint && npm run lint:md',
  labels=['quality'],
  deps=[
    'apps',
    'packages',
    'docs',
    'eslint.config.mjs',
    '.markdownlint-cli2.jsonc',
  ],
)

# ---------------------------------------------------------------------------
# Tests — auto-trigger
# ---------------------------------------------------------------------------

local_resource(
  'platform-api-tests',
  cmd='npm run test:platform-api',
  labels=['tests'],
  resource_deps=['postgres', 'redis'],
  deps=[
    'apps/platform-api/src',
    'apps/platform-api/tests',
    'packages',
  ],
)

local_resource(
  'react-tests',
  cmd='npm run test:frontend:run',
  labels=['tests'],
  deps=[
    'apps/react-enterprise-app/src',
    'packages',
  ],
)

# ---------------------------------------------------------------------------
# Manual-trigger checks
# ---------------------------------------------------------------------------

local_resource(
  'architecture-check',
  cmd='node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict',
  labels=['quality'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  deps=[
    'apps',
    'packages',
    'docs/adr',
    'docs/architecture',
    'docs/schemas',
  ],
)

local_resource(
  'make-check',
  cmd='make check',
  labels=['quality'],
  trigger_mode=TRIGGER_MODE_MANUAL,
)

local_resource(
  'e2e-dev',
  cmd='npm run test:e2e',
  labels=['tests'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  resource_deps=['platform-api', 'react-app'],
)
