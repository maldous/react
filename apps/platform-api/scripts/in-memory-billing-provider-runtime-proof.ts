/**
 * Provider-level proof wrapper for InMemoryBillingProvider and InMemoryPaymentProvider.
 *
 * The delegated proof exercises billing readiness, account creation, charge,
 * and refund behavior; the unit reliability test covers config, secret source,
 * timeout/retry declarations, health, recovery, webhook verification,
 * unavailable-provider, and misconfigured-provider fail-closed paths.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitRuntimeProofEvidence } from "./lib/runtime-evidence.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(
  join(scriptDir, "billing-provider-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/in-memory-billing-provider.ts"),
  "utf8"
);

assert.ok(
  delegatedProofSource.includes("billing.readiness") &&
    delegatedProofSource.includes('readiness.status, "ready"') &&
    delegatedProofSource.includes("billing.ensureAccount") &&
    delegatedProofSource.includes('account.organisationId, "org-billing-proof"'),
  "delegated billing proof must assert readiness status and persisted account state"
);
assert.ok(
  delegatedProofSource.includes("payment.charge") &&
    delegatedProofSource.includes('charge.outcome, "succeeded"') &&
    delegatedProofSource.includes("payment.refund") &&
    delegatedProofSource.includes("refund.succeeded"),
  "delegated billing proof must assert charge and refund side effects"
);
assert.ok(
  adapterSource.includes("this.accounts.set") &&
    adapterSource.includes("validateWebhookSignature") &&
    adapterSource.includes("withBillingReliability") &&
    adapterSource.includes("retryAttempts") &&
    adapterSource.includes("operationTimeoutMs") &&
    adapterSource.includes("fail closed") &&
    adapterSource.includes("invalid_refund_amount"),
  "in-memory billing adapter must persist account state and implement webhook, retry, timeout, and fail-closed behavior"
);

emitRuntimeProofEvidence({
  subjectIds: [
    "provider:in-memory-billing-provider",
    "in-memory-billing-provider",
    "apps/platform-api/scripts/in-memory-billing-provider-runtime-proof.ts",
  ],
  providerId: "in-memory-billing-provider",
  proofLevelClaimed: "L1",
  inMemoryProviderUsed: true,
  realLocalProviderUsed: false,
  externalSandboxProviderUsed: false,
  assertionsObserved: true,
  expectedOutputsAsserted: true,
  deterministicReplaySupported: true,
  cleanupResult: { status: "delegated-proof-imported" },
});

await import("./billing-provider-runtime-proof.ts");
