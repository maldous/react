/**
 * Provider-level proof wrapper for the prometheus-metrics adapter.
 *
 * The delegated live proof exercises Prometheus availability, scrape target
 * health, metric family registration, bounded labels, counter movement,
 * readiness degradation, external route denial, retry/unavailable failure
 * paths, and misconfigured-provider failure exits.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emitRuntimeProofObservabilityEvidence } from "./lib/runtime-evidence.ts";

emitRuntimeProofObservabilityEvidence("prometheus-metrics");

const proofSource = readFileSync(
  "apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("http_requests_total increases after activity") &&
    proofSource.includes("platform-api target health is 'up'") &&
    proofSource.includes("/readyz status is 'ready' when Prometheus up"),
  "Prometheus wrapper must assert delegated metric counter, scrape-target status, and readiness state side effects"
);
assert.ok(
  proofSource.includes("/metrics NOT reachable on external Caddy port") &&
    proofSource.includes("no forbidden labels") &&
    proofSource.includes("PROOF FAILED"),
  "Prometheus wrapper must assert external denial, bounded labels, and explicit failure modes"
);

await import("./metrics-prometheus-runtime-proof.ts");
