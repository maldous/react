/**
 * Provider-ID proof entrypoint for postgres-email-sender-store.
 *
 * The substantive proof is email-sender-runtime-proof.ts, which validates tenant
 * email sender readiness, live SMTP delivery, provider health probing,
 * unavailable-provider fail-closed behavior, and secret-free failure handling.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./email-sender-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/email-sender-runtime-proof.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-email-sender-store.ts",
  "utf8"
);
const usecaseSource = readFileSync("apps/platform-api/src/usecases/email-sender.ts", "utf8");

assert.ok(
  proofSource.includes("readiness classifier") &&
    proofSource.includes("Send a real email to Mailpit") &&
    proofSource.includes("SMTP provider health probe reports Mailpit ready") &&
    proofSource.includes("unavailable SMTP provider health probe fails closed") &&
    usecaseSource.includes("markValidated") &&
    usecaseSource.includes("testEmailSender"),
  "email sender store proof must assert readiness, validation, live delivery, and provider health state"
);
assert.ok(
  proofSource.includes("should fail") &&
    proofSource.includes("No secret is printed") &&
    adapterSource.includes("decryptTenantSecret") &&
    adapterSource.includes("return null") &&
    adapterSource.includes("postgres-email-sender-store unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "email sender store proof must assert failed delivery, secret-free errors, decrypt failure handling, and unavailable fail-closed modes"
);
