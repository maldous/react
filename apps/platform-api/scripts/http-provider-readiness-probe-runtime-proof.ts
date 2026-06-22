/**
 * Provider-ID proof entrypoint for the generic HTTP provider readiness probe.
 *
 * The substantive proof lives in composed-provider-readiness-runtime-proof.ts and exercises
 * ready, degraded, not_configured, adapter-confirmed lifecycle, and secret-free payloads.
 * This provider-named wrapper lets assurance attach that runtime proof to the
 * http-provider-readiness-probe adapter without changing validator logic.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(
  join(scriptDir, "composed-provider-readiness-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/http-provider-readiness-probe.ts"),
  "utf8"
);
const usecaseSource = readFileSync(
  join(scriptDir, "../src/usecases/composed-providers.ts"),
  "utf8"
);

assert.ok(
  delegatedProofSource.includes("every provider reports a valid honest status") &&
    delegatedProofSource.includes('p.status === "ready"') &&
    delegatedProofSource.includes('p.status === "degraded"') &&
    delegatedProofSource.includes('p.status === "not_configured"') &&
    delegatedProofSource.includes("lifecycle is adapter-confirmed"),
  "delegated provider readiness proof must assert ready, degraded, not_configured, and lifecycle status state"
);
assert.ok(
  delegatedProofSource.includes("reports degraded when unreachable") &&
    delegatedProofSource.includes("no secret (master key/token) in any readiness payload") &&
    delegatedProofSource.includes("never faked"),
  "delegated provider readiness proof must assert unreachable failure mode and secret-free payload state"
);
assert.ok(
  adapterSource.includes("AbortController") &&
    adapterSource.includes("maxAttempts") &&
    adapterSource.includes('status: "not_configured"') &&
    adapterSource.includes('status: "degraded"') &&
    adapterSource.includes('status: "ready"') &&
    adapterSource.includes("authHeader") &&
    adapterSource.includes("never reports ready unless"),
  "HTTP readiness probe adapter must implement timeout, retry, no-secret auth, and fail-closed status semantics"
);
assert.ok(
  usecaseSource.includes("getComposedProviderReadiness") &&
    usecaseSource.includes("deriveReadinessLifecycle") &&
    usecaseSource.includes('r.status === "not_configured"') &&
    usecaseSource.includes('r.status === "ready" ? "ready" : "degraded"'),
  "composed provider usecase must derive lifecycle state from actual provider readiness status"
);

await import("./composed-provider-readiness-runtime-proof.ts");
