/**
 * Provider-ID proof entrypoint for postgres-notification-repository.
 *
 * The substantive proof is notification-dispatch-runtime-proof.ts, which
 * validates live notification preferences, dispatch fan-out, durable log status,
 * suppression, and secret-free payload handling.
 */

import "./notification-dispatch-runtime-proof.ts";
