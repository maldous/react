import { test } from "node:test";
import assert from "node:assert/strict";
import { loadObservabilityProbeConfig } from "../../src/config/observability-probe-config.ts";

test("probe endpoints are all optional → undefined when unset", () => {
  const cfg = loadObservabilityProbeConfig({ source: {} });
  for (const k of [
    "grafanaUrl",
    "grafanaPort",
    "otelHealthUrl",
    "otelHealthPort",
    "prometheusUrl",
    "sentryDsn",
  ] as const) {
    assert.equal(cfg[k], undefined);
  }
});

test("explicit URL wins; port drives the derived URL in the caller", () => {
  const cfg = loadObservabilityProbeConfig({
    source: { GRAFANA_PORT: "3000", OTEL_HEALTH_URL: "http://x/health" },
  });
  assert.equal(cfg.grafanaPort, "3000");
  assert.equal(cfg.grafanaUrl, undefined); // caller derives http://localhost:3000
  assert.equal(cfg.otelHealthUrl, "http://x/health");
});
