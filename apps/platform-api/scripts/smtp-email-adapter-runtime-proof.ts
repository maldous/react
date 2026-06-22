/**
 * Provider-ID proof entrypoint for smtp-email-adapter.
 *
 * The substantive proof is email-sender-runtime-proof.ts, which exercises the
 * SMTP adapter against live Mailpit, validates provider health/readiness,
 * proves unavailable-provider fail-closed behavior, and classifies failures
 * without exposing credentials.
 */

import "./email-sender-runtime-proof.ts";
