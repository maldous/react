/**
 * Tenant Observability readiness runtime proof (ADR-0050 / ADR-ACT-0219).
 *
 *   1. high-cardinality-label guard holds (low-cardinality → labels; ids → | json)
 *   2. pure classifier — honest verdicts
 *   3. LIVE Loki probe: bounded ingestion + tenant-scoped query against the local
 *      Loki backend (make compose-up-default). A failure classifies as
 *      provider_unreachable — never faked.
 *
 * Usage: npm run proof:tenant-observability
 *   Requires Loki up (default http://localhost:3100; override with LOKI_URL).
 */

import { createLokiLogQueryAdapter } from "@platform/adapters-loki";
import {
  assertHighCardinalityGuard,
  classifyObservability,
  getTenantObservabilityReadiness,
} from "../src/usecases/tenant-observability.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Tenant observability runtime proof\n");

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
  const readiness = await getTenantObservabilityReadiness({ organisationId: "org-proof", port });
  check(
    `live Loki probe reachable @ ${lokiUrl}`,
    readiness.logIngestion === "ok",
    `status=${readiness.status} ingestion=${readiness.logIngestion} tenantQuery=${readiness.tenantScopedQuery}`
  );
  check(
    "trace correlation honestly not_applicable",
    readiness.traceCorrelation === "not_applicable"
  );

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
