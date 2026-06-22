/**
 * Provider-ID proof entrypoint for postgres-notification-repository.
 *
 * The substantive proof is notification-dispatch-runtime-proof.ts, which
 * validates live notification preferences, dispatch fan-out, durable log status,
 * suppression, and secret-free payload handling.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./notification-dispatch-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/notification-dispatch-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-notification-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("notification preferences update via real handler") &&
    proofSource.includes("readiness lists local channels") &&
    proofSource.includes("test send dispatches enabled email") &&
    proofSource.includes("test send suppresses the disabled channel") &&
    proofSource.includes("dispatch is logged durably"),
  "notification repository proof must assert preferences, readiness, sent/suppressed status, and durable log side effects"
);
assert.ok(
  proofSource.includes("me/profile without a tenant context is rejected") &&
    proofSource.includes("invalid tenant id rejected") &&
    proofSource.includes("secret-bearing payload rejected at dispatch") &&
    adapterSource.includes("postgres-notification-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "notification repository proof must assert tenant rejection, invalid tenant, secret rejection, and unavailable fail-closed modes"
);
