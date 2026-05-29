# Tiltfile — Enterprise React Platform
# ADR-0027: Tilt local development feedback loop
#
# MODES
#   Fast dev (default):   tilt up
#   Production parity:    prod-build-and-test and aldous-smoke are available
#                         as manual resources. Full Compose web-profile container
#                         wiring is deferred — see ADR-ACT-0128 (In Progress).
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
# Optional auth profile (manual)
# ---------------------------------------------------------------------------

local_resource(
  'identity-profile',
  cmd='make compose-up-identity',
  labels=['auth'],
  trigger_mode=TRIGGER_MODE_MANUAL,
)

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
  resource_deps=['platform-api'],
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
  resource_deps=['react-app'],
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

# ---------------------------------------------------------------------------
# i18n validation — auto-trigger, report-only (ADR-ACT-0123, ADR-ACT-0129)
# Scans source for translation key usage and reports keys missing from en-GB.json.
# Report-only until ADR-ACT-0121 (React text migration) and ADR-ACT-0122
# (API message migration) are complete.
# ---------------------------------------------------------------------------

local_resource(
  'i18n-validation',
  cmd='node tools/architecture/validate-i18n/src/index.mjs .',
  labels=['quality'],
  resource_deps=['platform-api', 'react-app'],
  deps=[
    'packages/i18n-runtime/locales',
    'apps/react-enterprise-app/src',
    'apps/platform-api/src',
    'packages',
  ],
)

# ---------------------------------------------------------------------------
# Production parity — manual trigger (ADR-ACT-0128 — In Progress)
# prod-build-and-test runs npm run test:e2e:prod: builds the SPA with vite,
# then runs Playwright against vite preview. This is NOT full Compose web
# profile production (platform-api container + Caddy container); that wiring
# is deferred. See ADR-ACT-0128 for scope.
# ---------------------------------------------------------------------------

local_resource(
  'platform-api-web',
  cmd='docker compose --profile web up -d platform-api',
  labels=['app', 'app:production'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  resource_deps=['postgres', 'redis', 'keycloak'],
  deps=[
    'compose.yaml',
    'apps/platform-api/Dockerfile',
    'apps/platform-api/src',
    'packages',
    'docker/caddy/Caddyfile',
  ],
)

local_resource(
  'react-app-web',
  cmd='docker compose --profile web up -d react-app',
  labels=['app', 'app:production'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  resource_deps=['platform-api-web'],
  deps=[
    'compose.yaml',
    'apps/react-enterprise-app/Dockerfile',
    'apps/react-enterprise-app/src',
    'apps/react-enterprise-app/index.html',
    'apps/react-enterprise-app/vite.config.ts',
    'docker/caddy/Caddyfile',
  ],
)

local_resource(
  'prod-build-and-test',
  cmd='npm run test:e2e:prod',
  labels=['tests'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  deps=[
    'apps/react-enterprise-app/Dockerfile',
    'apps/platform-api/Dockerfile',
    'docker/caddy/Caddyfile',
    'apps/react-enterprise-app/src',
    'apps/platform-api/src',
  ],
)

local_resource(
  'aldous-smoke',
  cmd='npx playwright test --config playwright.aldous.config.ts',
  labels=['tests'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  resource_deps=['platform-api-web', 'react-app-web'],
)
