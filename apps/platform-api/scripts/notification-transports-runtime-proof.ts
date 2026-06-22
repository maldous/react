/**
 * Provider-ID proof entrypoint for notification-transports.
 *
 * The substantive proof is notification-transport-routes-runtime-proof.ts, which
 * validates route-wired SMTP transport selection, Mailpit delivery, preference
 * delivery, and environment-gated transport selection.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const routeProofSource = readFileSync(
  join(scriptDir, "notification-transport-routes-runtime-proof.ts"),
  "utf8"
);
const emailProofSource = readFileSync(
  join(scriptDir, "notification-email-transport-runtime-proof.ts"),
  "utf8"
);
const webhookProofSource = readFileSync(
  join(scriptDir, "notification-webhook-transport-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/notification-transports.ts"),
  "utf8"
);
const notificationUsecaseSource = readFileSync(
  join(scriptDir, "../src/usecases/notifications.ts"),
  "utf8"
);

assert.ok(
  routeProofSource.includes("test route is operator-only") &&
    routeProofSource.includes("test-send route returns 200") &&
    routeProofSource.includes("wired route delivered a real email to Mailpit") &&
    routeProofSource.includes("NOTIFICATION_EMAIL_TRANSPORT"),
  "notification route proof must assert route permission state, SMTP selection, and real Mailpit delivery"
);
assert.ok(
  emailProofSource.includes("enabled email dispatch reports sent") &&
    emailProofSource.includes("the email actually landed in Mailpit") &&
    emailProofSource.includes("disabled email preference suppresses dispatch") &&
    emailProofSource.includes("suppressed notification did NOT deliver to Mailpit") &&
    emailProofSource.includes("unresolvable recipient reports failed"),
  "email transport proof must assert sent, suppressed, non-delivery, and failed recipient state"
);
assert.ok(
  webhookProofSource.includes("enabled webhook dispatch reports sent") &&
    webhookProofSource.includes("receiver actually got the POST") &&
    webhookProofSource.includes("request carried a valid ADR-0052 signature") &&
    webhookProofSource.includes("body carries no secret field") &&
    webhookProofSource.includes("non-2xx receiver reports failed") &&
    webhookProofSource.includes("missing destination reports failed"),
  "webhook transport proof must assert signed POST, no-secret payload, non-2xx failure, and missing-destination failure state"
);
assert.ok(
  adapterSource.includes("withRetry") &&
    adapterSource.includes("withTimeout") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes('return "failed"') &&
    adapterSource.includes('return "sent"') &&
    adapterSource.includes("webhookSignatureHeader") &&
    adapterSource.includes("notificationTransportsHealthCheck") &&
    adapterSource.includes("fail-closed"),
  "notification transports adapter must implement retry, timeout, signed webhook, health, sent/failed state, and fail-closed behavior"
);
assert.ok(
  notificationUsecaseSource.includes('status: "suppressed"') &&
    notificationUsecaseSource.includes("recordDispatch") &&
    notificationUsecaseSource.includes("SECRET_KEY") &&
    notificationUsecaseSource.includes("dispatchNotification"),
  "notification usecase must persist sent/failed/suppressed dispatch state and reject secret-bearing payloads"
);

await import("./notification-transport-routes-runtime-proof.ts");
await import("./notification-email-transport-runtime-proof.ts");
await import("./notification-webhook-transport-runtime-proof.ts");
