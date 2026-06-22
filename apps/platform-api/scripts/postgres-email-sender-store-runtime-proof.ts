/**
 * Provider-ID proof entrypoint for postgres-email-sender-store.
 *
 * The substantive proof is email-sender-runtime-proof.ts, which validates tenant
 * email sender readiness, live SMTP delivery, provider health probing,
 * unavailable-provider fail-closed behavior, and secret-free failure handling.
 */

import "./email-sender-runtime-proof.ts";
