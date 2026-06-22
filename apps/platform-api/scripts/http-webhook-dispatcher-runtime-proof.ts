/**
 * Provider-ID entrypoint for the HttpWebhookDispatcher runtime proofs.
 *
 * The substantive proofs remain split across:
 * - webhooks-runtime-proof.ts for signed one-shot dispatch and delivery recording
 * - webhook-worker-runtime-proof.ts for retry, backoff, and dead-letter handling
 * - webhook-redrive-runtime-proof.ts for operator recovery/redrive
 */
import "./webhooks-runtime-proof.ts";
