/**
 * Provider-ID entrypoint for the HttpWebhookDispatcher runtime proofs.
 *
 * The substantive proofs remain split across:
 * - webhooks-runtime-proof.ts for signed one-shot dispatch and delivery recording
 * - webhook-worker-runtime-proof.ts for retry, backoff, and dead-letter handling
 * - webhook-redrive-runtime-proof.ts for operator recovery/redrive
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const oneShotProofSource = readFileSync(join(scriptDir, "webhooks-runtime-proof.ts"), "utf8");
const workerProofSource = readFileSync(join(scriptDir, "webhook-worker-runtime-proof.ts"), "utf8");
const redriveProofSource = readFileSync(
  join(scriptDir, "webhook-redrive-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/http-webhook-dispatcher.ts"),
  "utf8"
);
const workerSource = readFileSync(join(scriptDir, "../src/usecases/webhook-worker.ts"), "utf8");
const webhookUsecaseSource = readFileSync(join(scriptDir, "../src/usecases/webhooks.ts"), "utf8");

assert.ok(
  oneShotProofSource.includes("test dispatch delivered (HTTP 200)") &&
    oneShotProofSource.includes("received payload is correctly HMAC-signed") &&
    oneShotProofSource.includes("delivery log records a delivered attempt") &&
    oneShotProofSource.includes("cleanup removed the temp webhook"),
  "one-shot webhook proof must assert signed delivery state, durable delivered status, and cleanup side effects"
);
assert.ok(
  workerProofSource.includes("tick 1 retries the failing delivery") &&
    workerProofSource.includes("tick 2 delivers after the receiver recovers") &&
    workerProofSource.includes("always-failing delivery is dead-lettered after maxAttempts") &&
    workerProofSource.includes("event fan-out enqueued one delivery"),
  "webhook worker proof must assert retry, recovered delivery, dead-letter, and fan-out state"
);
assert.ok(
  redriveProofSource.includes("delivery driven to dead") &&
    redriveProofSource.includes("redrive requeued the dead delivery") &&
    redriveProofSource.includes("after redrive: dead=0, pending=1") &&
    redriveProofSource.includes("redriven delivery now delivered") &&
    redriveProofSource.includes("metrics carry no secret"),
  "webhook redrive proof must assert dead, pending, delivered, metric, and no-secret state"
);
assert.ok(
  adapterSource.includes("AbortSignal.timeout") &&
    adapterSource.includes("WEBHOOK_RETRY_POLICY.timeoutMs") &&
    adapterSource.includes("ok: false") &&
    adapterSource.includes("status: null") &&
    adapterSource.includes("dispatch failed"),
  "HTTP webhook dispatcher adapter must implement bounded POST and classified failed status state"
);
assert.ok(
  workerSource.includes("markDeliveryResult") &&
    workerSource.includes('status: "pending"') &&
    workerSource.includes('status: "dead"') &&
    workerSource.includes('status: "delivered"') &&
    workerSource.includes("webhookSignatureHeader"),
  "webhook worker must persist pending, dead, and delivered delivery state with signed requests"
);
assert.ok(
  webhookUsecaseSource.includes("recordDelivery") &&
    webhookUsecaseSource.includes("classifyWebhookReadiness") &&
    webhookUsecaseSource.includes("redriveDeadDeliveries") &&
    webhookUsecaseSource.includes("AuditAction.WebhookRedriven"),
  "webhook usecase must record delivery state, classify readiness, and audit redrive side effects"
);

for (const proof of [
  "webhooks-runtime-proof.ts",
  "webhook-worker-runtime-proof.ts",
  "webhook-redrive-runtime-proof.ts",
]) {
  execFileSync(
    process.execPath,
    ["--loader", join(repoRoot, "apps/platform-api/loader.mjs"), join(scriptDir, proof)],
    { stdio: "inherit", env: process.env }
  );
}
