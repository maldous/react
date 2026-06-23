import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { routes } from "../src/server/routes.ts";
import { loadObservabilityProbeConfig } from "../src/config/observability-probe-config.ts";
import { emitRuntimeProofObservabilityEvidence } from "./lib/runtime-evidence.ts";

emitRuntimeProofObservabilityEvidence("observability-provider-closure");

async function main(): Promise<void> {
  const compose = readFileSync(new URL("../../../compose.yaml", import.meta.url), "utf8");
  const config = loadObservabilityProbeConfig({
    source: {
      LOKI_URL: "http://localhost:3100",
      GRAFANA_URL: "http://localhost:3200",
      OTEL_HEALTH_URL: "http://localhost:13133",
      PROMETHEUS_URL: "http://localhost:9090",
      SENTRY_DSN: "https://public@example.com/1",
    },
  });
  const observabilityRoute = routes.find((r) => r.path === "/api/admin/observability");
  const readinessRoute = routes.find((r) => r.path === "/api/admin/observability/readiness");
  assert.ok(compose.includes("profiles: [observability]"), "observability profile exists");
  assert.ok(
    compose.includes("profiles: [observability-provider]"),
    "observability-provider profile exists"
  );
  assert.ok(compose.includes("loki:"), "loki service exists");
  assert.ok(compose.includes("grafana:"), "grafana service exists");
  assert.ok(compose.includes("tempo:"), "tempo service exists");
  assert.ok(compose.includes("alertmanager:"), "alertmanager service exists");
  assert.ok(compose.includes("sentry-postgres:"), "sentry stack exists");
  assert.ok(compose.includes("sentry-redis:"), "sentry stack is wired");
  assert.ok(observabilityRoute, "observability control route exists");
  assert.ok(readinessRoute, "observability readiness route exists");
  assert.equal(config.grafanaUrl, "http://localhost:3200");
  assert.equal(config.prometheusUrl, "http://localhost:9090");
  assert.equal(config.sentryDsn, "https://public@example.com/1");
  console.log(
    JSON.stringify(
      {
        capability: "V2 observability provider closure",
        result: "PASSED",
        routes: [observabilityRoute?.path, readinessRoute?.path],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
