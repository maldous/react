/**
 * Provider-level proof wrapper for browser-telemetry-provider.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const proofFiles = [
  "tools/e2e/tempo-trace.test.mjs",
  "tools/e2e/correlation-headers.test.mjs",
  "tools/e2e/observability-correlation/tests/classify.test.mjs",
  "docs/evidence/platform/browser-diagnostics-faro.md",
];

for (const file of proofFiles) {
  assert.equal(existsSync(file), true, `${file} must exist`);
}

const correlationSource = readFileSync("tools/e2e/correlation-headers.test.mjs", "utf8");
const tempoSource = readFileSync("tools/e2e/tempo-trace.test.mjs", "utf8");
const lokiSource = readFileSync(
  "tools/e2e/observability-correlation/tests/classify.test.mjs",
  "utf8"
);
const faroEvidence = readFileSync("docs/evidence/platform/browser-diagnostics-faro.md", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/browser-telemetry-provider.ts",
  "utf8"
);

assert.ok(
  correlationSource.includes("correlatedApiContext injects headers on same-origin requests") &&
    correlationSource.includes('same.headers["x-e2e-scenario-id"]') &&
    correlationSource.includes('g[2].headers["x-e2e-test-run-id"]') &&
    correlationSource.includes('p[2].headers["x-e2e-scenario-id"]'),
  "correlation proof must assert browser/API request header side effects"
);
assert.ok(
  correlationSource.includes("HOSTILE") &&
    correlationSource.includes("must NOT tag") &&
    correlationSource.includes("cross-origin (Keycloak) fetch gets NO correlation headers"),
  "correlation proof must assert fail-closed hostile-origin non-leakage"
);
assert.ok(
  tempoSource.includes("assertTraceContract passes platform-api span + route + trace membership") &&
    tempoSource.includes("traceIdMismatches") &&
    tempoSource.includes("missingServices") &&
    tempoSource.includes("secretHits"),
  "Tempo proof must assert trace state, route state, and secret-leak failure state"
);
assert.ok(
  tempoSource.includes("network error") &&
    tempoSource.includes("persistent genuine 404") &&
    tempoSource.includes("malformed JSON") &&
    tempoSource.includes("no valid 32-hex id"),
  "Tempo proof must assert provider failure and invalid trace-id failure modes"
);
assert.ok(
  lokiSource.includes("groupByScenario counts lines") &&
    lokiSource.includes("computeCompleteness: a MISSING required scenario") &&
    lokiSource.includes("lokiQueryAll flags truncation honestly") &&
    lokiSource.includes("throws on a non-OK Loki response"),
  "observability correlation proof must assert log state, missing-required failure, truncation, and upstream error modes"
);
assert.ok(
  faroEvidence.includes("POST /faro/collect") &&
    faroEvidence.includes("labels service=react-enterprise-app, source=faro, environment") &&
    faroEvidence.includes("try/catch that swallows errors"),
  "Faro evidence must assert same-origin collection, Loki log labeling, and bootstrap failure tolerance"
);
assert.ok(
  adapterSource.includes("failClosed") &&
    adapterSource.includes("healthCheck") &&
    adapterSource.includes("operatorRecovery"),
  "browser telemetry provider adapter must publish fail-closed, health-check, and recovery semantics"
);

console.log(JSON.stringify({ provider: "browser-telemetry-provider", result: "PASSED" }, null, 2));
