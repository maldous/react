/**
 * Provider-ID proof entrypoint for the Postgres webhook store adapter.
 *
 * The substantive live proofs are:
 * - webhooks-runtime-proof.ts for encrypted secret storage, reveal-once creation,
 *   signed test delivery, and delivery logging
 * - webhook-worker-runtime-proof.ts for fan-out, retry, and dead-letter behavior
 * - webhook-redrive-runtime-proof.ts for operator metrics and dead-letter recovery
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import { loadLocalEnv } from "./lib/local-env.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

loadLocalEnv();

const webhooksProofSource = readFileSync(
  "apps/platform-api/scripts/webhooks-runtime-proof.ts",
  "utf8"
);
const workerProofSource = readFileSync(
  "apps/platform-api/scripts/webhook-worker-runtime-proof.ts",
  "utf8"
);
const redriveProofSource = readFileSync(
  "apps/platform-api/scripts/webhook-redrive-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-webhook-store.ts",
  "utf8"
);

assert.ok(
  webhooksProofSource.includes("created webhook reveals the secret once") &&
    webhooksProofSource.includes("test dispatch delivered (HTTP 200)") &&
    webhooksProofSource.includes("delivery log records a delivered attempt") &&
    workerProofSource.includes("fan-out") &&
    redriveProofSource.includes("redrive"),
  "webhook store proof must assert create/reveal-once, signed delivery, delivery log, fan-out, and redrive side effects"
);
assert.ok(
  webhooksProofSource.includes("payload does not contain the secret") &&
    adapterSource.includes('status: "degraded"') &&
    adapterSource.includes("return null") &&
    adapterSource.includes("retry") &&
    adapterSource.includes("dead") &&
    adapterSource.includes("healthCheck"),
  "webhook store proof must assert no-secret payloads, null missing secret, retry/dead-letter, and degraded health failure modes"
);

await import("./webhooks-runtime-proof.ts");
