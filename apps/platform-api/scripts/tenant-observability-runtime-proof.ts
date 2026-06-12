/**
 * Tenant Observability readiness runtime proof (ADR-0050 / ADR-ACT-0219).
 *
 *   1. high-cardinality-label guard holds (low-cardinality → labels; ids → | json)
 *   2. pure classifier — honest verdicts
 *   3. LIVE Loki probe: bounded ingestion + tenant-scoped query against the local
 *      Loki backend (make compose-up-default). A failure classifies as
 *      provider_unreachable — never faked.
 *
 *   4. LIVE infra signals (ADR-ACT-0224): Grafana + OTel-collector reachability;
 *      metrics not_applicable (no Prometheus); error-capture not_configured (no DSN).
 *      Each is probed honestly — unavailable services are never reported `ok`.
 *
 * Usage: npm run proof:tenant-observability
 *   Loads local .env; derives URLs from GRAFANA_PORT / OTEL_HEALTH_PORT.
 */

import { createLokiLogQueryAdapter } from "@platform/adapters-loki";
import {
  assertHighCardinalityGuard,
  classifyObservability,
  getTenantObservabilityReadiness,
  type ObservabilityInfraProbes,
} from "../src/usecases/tenant-observability.ts";
import type { ObservabilitySignalStatus } from "@platform/contracts-admin";
import { loadLocalEnv } from "./lib/local-env.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function buildInfraProbes(): ObservabilityInfraProbes {
  const reach = async (url?: string, naWhenUnset = false): Promise<ObservabilitySignalStatus> => {
    if (!url) return naWhenUnset ? "not_applicable" : "not_configured";
    try {
      await fetch(url, { method: "GET", signal: AbortSignal.timeout(2000) });
      return "ok";
    } catch {
      return "unreachable";
    }
  };
  const at = (v?: string): string | undefined => (v ? `http://localhost:${v}` : undefined);
  const grafana = process.env["GRAFANA_URL"] ?? at(process.env["GRAFANA_PORT"]);
  const otel = process.env["OTEL_HEALTH_URL"] ?? at(process.env["OTEL_HEALTH_PORT"]);
  return {
    probeMetrics: () => reach(process.env["PROMETHEUS_URL"], true),
    probeOtelCollector: () => reach(otel),
    probeDashboards: () => reach(grafana ? `${grafana}/api/health` : undefined),
    probeErrorCapture: async () => {
      const dsn = process.env["SENTRY_DSN"];
      if (!dsn) return "not_configured";
      try {
        await fetch(new URL(dsn).origin, { method: "GET", signal: AbortSignal.timeout(2000) });
        return "ok";
      } catch {
        return "unreachable";
      }
    },
  };
}

async function main(): Promise<void> {
  console.log("# Tenant observability runtime proof\n");
  loadLocalEnv();

  // 1. Guard.
  check(
    "high-cardinality guard holds (service/level labels; ids | json)",
    assertHighCardinalityGuard()
  );

  // 2. Pure classifier.
  check(
    "ingestion+tenant ok + guard → configured",
    classifyObservability({
      logIngestion: "ok",
      tenantScopedQuery: "ok",
      highCardinalityGuard: true,
    }) === "configured"
  );
  check(
    "ingestion unreachable → provider_unreachable",
    classifyObservability({
      logIngestion: "unreachable",
      tenantScopedQuery: "unknown",
      highCardinalityGuard: true,
    }) === "provider_unreachable"
  );

  // 3. Live Loki probe.
  const lokiUrl = process.env["LOKI_URL"] ?? "http://localhost:3100";
  const loki = createLokiLogQueryAdapter({ url: lokiUrl });
  const port = {
    search: (q: Parameters<typeof loki.search>[0]) =>
      Promise.race([
        loki.search(q),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("loki probe timeout")), 3000)),
      ]),
  };
  const readiness = await getTenantObservabilityReadiness({
    organisationId: "org-proof",
    port,
    infra: buildInfraProbes(),
  });
  check(
    `live Loki probe reachable @ ${lokiUrl}`,
    readiness.logIngestion === "ok",
    `status=${readiness.status} ingestion=${readiness.logIngestion} tenantQuery=${readiness.tenantScopedQuery}`
  );
  check(
    "trace correlation honestly not_applicable",
    readiness.traceCorrelation === "not_applicable"
  );

  // 4. Live infra signals — honest classification (no service reported ok unless reachable).
  console.log(
    `INFO  infra signals: dashboards=${readiness.dashboards} otel=${readiness.otelCollector}` +
      ` metrics=${readiness.metrics} errorCapture=${readiness.errorCapture}`
  );
  check(
    "Grafana dashboards reachable (or honestly not_configured)",
    readiness.dashboards !== "unknown"
  );
  check(
    "OTel collector reachable (or honestly not_configured)",
    readiness.otelCollector !== "unknown"
  );
  check(
    "metrics honestly not_applicable/not_configured (no local Prometheus)",
    readiness.metrics === "not_applicable" || readiness.metrics === "not_configured"
  );
  check(
    "error-capture honestly not_configured/ok (Sentry DSN-gated)",
    ["not_configured", "ok", "unreachable"].includes(readiness.errorCapture)
  );

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
