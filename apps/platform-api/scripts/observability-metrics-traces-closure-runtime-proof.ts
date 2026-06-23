import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { routes } from "../src/server/routes.ts";
import { emitRuntimeProofObservabilityEvidence } from "./lib/runtime-evidence.ts";

emitRuntimeProofObservabilityEvidence("observability-metrics-traces-closure");

async function main(): Promise<void> {
  const compose = readFileSync(new URL("../../../compose.yaml", import.meta.url), "utf8");
  const promConfig = readFileSync(
    new URL("../../../docker/prometheus/prometheus.yml", import.meta.url),
    "utf8"
  );
  const tempoConfig = readFileSync(
    new URL("../../../docker/tempo/tempo.yaml", import.meta.url),
    "utf8"
  );
  const metricsRoute = routes.find((r) => r.path === "/metrics");
  const observabilityRoute = routes.find((r) => r.path === "/api/admin/observability");
  const readinessRoute = routes.find((r) => r.path === "/api/admin/observability/readiness");

  assert.ok(compose.includes("profiles: [observability]"), "observability profile exists");
  assert.ok(
    compose.includes("profiles: [observability-provider]"),
    "observability-provider profile exists"
  );
  assert.ok(compose.includes("loki:"), "loki exists");
  assert.ok(compose.includes("grafana:"), "grafana exists");
  assert.ok(compose.includes("tempo:"), "tempo exists");
  assert.ok(compose.includes("prometheus:"), "prometheus exists");
  assert.ok(compose.includes("alertmanager:"), "alertmanager exists");
  assert.ok(promConfig.includes("platform-api"), "prometheus scrapes platform-api");
  assert.ok(
    promConfig.includes("tenantId") && promConfig.includes("traceId"),
    "prometheus label relabeling guards exist"
  );
  assert.ok(tempoConfig.includes("trace"), "tempo trace storage configured");
  assert.ok(metricsRoute, "/metrics route exists");
  assert.ok(observabilityRoute, "observability control route exists");
  assert.ok(readinessRoute, "observability readiness route exists");
  console.log(
    JSON.stringify(
      {
        capability: "V2 metrics + traces closure",
        result: "PASSED",
        routes: [metricsRoute?.path, observabilityRoute?.path, readinessRoute?.path],
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
