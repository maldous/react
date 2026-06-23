# Tiltfile — Enterprise React Platform
#
# Default mode is Compose-free semantic development:
#   tilt up
#
# Real local provider parity is explicit:
#   tilt up -- --mode=compose
#   tilt up -- --mode=test-local
#
# ADR-0027: dev = semantic in-memory providers; test-local = Compose real-local providers.

config.define_string("mode", args=True)
cfg = config.parse()
tilt_mode = cfg.get("mode", "semantic-dev")
compose_mode = tilt_mode in ["compose", "test-local", "production"]

os.environ["KC_HOSTNAME"] = "http://localhost:8090/kc"
os.environ["MINIO_BROWSER_REDIRECT_URL"] = "http://localhost:9001"
os.environ["SENTRY_URL_PREFIX"] = "http://localhost:5173/sentry"
os.environ["WIREMOCK_PORT"] = "8085"
os.environ["COMPOSE_PROJECT_FILTER"] = "react-dev"

if compose_mode:
  docker_compose(
    "./compose.yaml",
    project_name="react-dev",
    profiles=[
      "external-mocks",
      "identity",
      "identity-mocks",
      "observability",
      "workflow-provider",
      "observability-provider",
      "pitr-provider",
      "antivirus-provider",
    ],
  )

  dc_resource("postgres", labels=["infra"])
  dc_resource("redis", labels=["infra"])
  dc_resource("clickhouse", labels=["infra"], links=[link("http://localhost:8124/play", "ClickHouse play")])
  dc_resource("minio", labels=["infra"], links=[link("http://localhost:9001/", "MinIO console")])
  dc_resource("mailpit", labels=["infra"], links=[link("http://localhost:8025/mailpit/", "Mailpit UI")])
  dc_resource("otel-collector", labels=["infra"])
  dc_resource("pgadmin", labels=["infra"], links=[link("http://localhost:5050/pgadmin/", "pgAdmin")])
  dc_resource("wiremock", labels=["mocks"])
  dc_resource("mock-oidc", labels=["auth"], links=[link("http://localhost:9080/", "mock-oidc")])
  dc_resource("keycloak-postgres", labels=["infra"])
  dc_resource("keycloak", labels=["auth"], links=[link("http://localhost:8090/kc/admin/", "Keycloak admin")], resource_deps=["keycloak-postgres"])
  dc_resource("loki", labels=["observability"])
  dc_resource("grafana", labels=["observability"], links=[link("http://localhost:3200/grafana/", "Grafana")], resource_deps=["loki"])
  dc_resource("alloy", labels=["observability"], resource_deps=["loki"])
  dc_resource("prometheus", labels=["observability-provider"], links=[link("http://localhost:9090", "Prometheus")], resource_deps=["otel-collector"])
  dc_resource("tempo", labels=["observability-provider"], links=[link("http://localhost:3201", "Tempo")], resource_deps=["otel-collector"])
  dc_resource("alertmanager", labels=["observability-provider"], links=[link("http://localhost:9093", "Alertmanager")], resource_deps=["prometheus"])
  dc_resource("windmill-postgres", labels=["workflow-provider"])
  dc_resource("windmill-redis", labels=["workflow-provider"])
  dc_resource("windmill", labels=["workflow-provider"], links=[link("http://localhost:8000", "Windmill")], resource_deps=["windmill-postgres", "windmill-redis"])
  dc_resource("windmill-worker", labels=["workflow-provider"], resource_deps=["windmill"])
  dc_resource("temporal-postgres", labels=["workflow-provider"])
  dc_resource("temporal", labels=["workflow-provider"], links=[link("http://localhost:7233", "Temporal")], resource_deps=["temporal-postgres"])
  dc_resource("temporal-ui", labels=["workflow-provider"], links=[link("http://localhost:8088", "Temporal UI")], resource_deps=["temporal"])
  dc_resource("pgbackrest", labels=["backup-provider"], resource_deps=["postgres", "minio"])
  dc_resource("clamav", labels=["security-provider"], links=[link("http://localhost:3310", "ClamAV")], resource_deps=["minio"])

  local_resource("keycloak-provision", cmd="make keycloak-provision ENV=dev", labels=["auth"], resource_deps=["keycloak"])
  local_resource("seed-idps", cmd="make seed-idps ENV=dev", labels=["auth"], resource_deps=["keycloak-provision", "mock-oidc"])
  local_resource("sentry", cmd="make sentry-up", labels=["observability"], links=[link("http://localhost:9060", "Sentry")], resource_deps=["postgres", "redis", "clickhouse"])
  local_resource("sonar", cmd="make sonar-up", labels=["quality"], links=[link("http://localhost:9064/sonar", "SonarQube")])

platform_api_deps = []
platform_api_env = {
  "APEX_DOMAIN": "dev.localhost",
}
platform_api_exports = "export APEX_DOMAIN=dev.localhost"

if compose_mode:
  platform_api_deps = ["postgres", "redis"]
else:
  platform_api_env.update({
    "USF_PROVIDER_MODE": "semantic-dev",
    "LOCAL_FIXTURE_SESSION": "tenant-admin",
    "AUTH_PROVIDER_MODE": "disabled",
    "SECRET_STORE_PROVIDER": "builtin",
    "TENANT_SECRET_ENCRYPTION_KEY": "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    "WEBHOOK_WORKER_DISABLED": "true",
    "V1C12B_RETENTION_TICK_DISABLED": "true",
  })
  platform_api_exports = "export APEX_DOMAIN=dev.localhost USF_PROVIDER_MODE=semantic-dev LOCAL_FIXTURE_SESSION=tenant-admin AUTH_PROVIDER_MODE=disabled SECRET_STORE_PROVIDER=builtin TENANT_SECRET_ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff WEBHOOK_WORKER_DISABLED=true V1C12B_RETENTION_TICK_DISABLED=true"

local_resource(
  "platform-api",
  serve_cmd="[ -f .env/dev.env ] || node scripts/env/generate-runtime-env.mjs dev; set -a && . ./.env/dev.env && set +a && " + platform_api_exports + " && npm run api:start:admin",
  readiness_probe=probe(
    http_get=http_get_action(port=3001, path="/healthz"),
    period_secs=5,
    failure_threshold=10,
    initial_delay_secs=3,
  ),
  labels=["app"],
  links=[
    link("http://localhost:3001/healthz", "health"),
    link("http://localhost:3001/readyz", "readiness"),
    link("http://localhost:3001/version", "version"),
    link("http://localhost:3001/api/session", "session"),
  ],
  resource_deps=platform_api_deps,
  deps=[
    "apps/platform-api/src",
    "packages",
    "apps/platform-api/loader.mjs",
  ],
  env=platform_api_env,
)

local_resource(
  "react-app",
  serve_cmd="[ -f .env/dev.env ] || node scripts/env/generate-runtime-env.mjs dev; set -a && . ./.env/dev.env && set +a && cd apps/react-enterprise-app && ../../node_modules/.bin/vite --port 5173",
  readiness_probe=probe(
    http_get=http_get_action(port=5173, path="/"),
    period_secs=5,
    failure_threshold=20,
    initial_delay_secs=5,
  ),
  labels=["app"],
  links=[link("http://localhost:5173", "React SPA")],
  resource_deps=["platform-api"],
  deps=[
    "apps/react-enterprise-app/src",
    "apps/react-enterprise-app/index.html",
    "apps/react-enterprise-app/vite.config.ts",
    "packages",
  ],
)

local_resource(
  "typecheck",
  cmd="npm run tsc:check",
  labels=["quality"],
  trigger_mode=TRIGGER_MODE_MANUAL,
)

local_resource(
  "v2-readiness",
  cmd="npm run v2:readiness -- --strict",
  labels=["governance"],
  trigger_mode=TRIGGER_MODE_MANUAL,
)
