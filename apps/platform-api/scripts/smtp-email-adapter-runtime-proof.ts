/**
 * Provider-ID proof entrypoint for smtp-email-adapter.
 *
 * The substantive proof is email-sender-runtime-proof.ts, which exercises the
 * SMTP adapter against live Mailpit, validates provider health/readiness,
 * proves unavailable-provider fail-closed behavior, and classifies failures
 * without exposing credentials.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync("apps/platform-api/scripts/email-sender-runtime-proof.ts", "utf8");
const adapterSource = readFileSync("apps/platform-api/src/adapters/smtp-email-adapter.ts", "utf8");

assert.ok(
  proofSource.includes("test email sent via SMTP") &&
    proofSource.includes("message visible in Mailpit") &&
    proofSource.includes("proof message cleaned up") &&
    adapterSource.includes("messageId"),
  "SMTP wrapper must assert live send, Mailpit readback, cleanup state, and message-id side effects"
);
assert.ok(
  proofSource.includes("unavailable SMTP provider health probe fails closed") &&
    proofSource.includes("unreachable provider classified") &&
    adapterSource.includes("degradedMode"),
  "SMTP wrapper must assert unavailable-provider classification and fail-closed health behaviour"
);

import "./email-sender-runtime-proof.ts";
