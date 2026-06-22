/**
 * Provider-ID proof entrypoint for the Postgres webhook store adapter.
 *
 * The substantive live proofs are:
 * - webhooks-runtime-proof.ts for encrypted secret storage, reveal-once creation,
 *   signed test delivery, and delivery logging
 * - webhook-worker-runtime-proof.ts for fan-out, retry, and dead-letter behavior
 * - webhook-redrive-runtime-proof.ts for operator metrics and dead-letter recovery
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

await import("./webhooks-runtime-proof.ts");
