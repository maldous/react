import {
  WEBHOOK_RETRY_POLICY,
  type WebhookDispatchPort,
  type WebhookDispatchRequest,
  type WebhookDispatchResult,
} from "../usecases/webhooks.ts";

export const httpWebhookDispatcherReliabilityEvidence = {
  provider: "http-webhook-dispatcher",
  configSource:
    "WEBHOOK_RETRY_POLICY supplies timeout/backoff/maxAttempts for dispatch workers; loader process.env controls worker enablement",
  secretSource:
    "signing credential material is read by the webhook store and passed only as a signature header",
  timeout: "single HTTP attempts use AbortSignal.timeout(WEBHOOK_RETRY_POLICY.timeoutMs)",
  retry:
    "retry and backoff are implemented by processDueDeliveries in apps/platform-api/src/usecases/webhook-worker.ts",
  degradedMode:
    "dispatch network errors return { ok: false, status: null, error } so callers can retry or dead-letter",
  failClosed:
    "disabled, deleted, unavailable, or repeatedly failing subscriptions are denied delivery and end in dead-letter state",
  fallbackRationale:
    "no fallback destination is attempted because webhook URLs are tenant-controlled explicit endpoints",
  healthCheck:
    "webhook readiness is classified by subscription state and delivery health; testWebhook performs an on-demand provider probe",
  operatorRecovery:
    "operators recover by inspecting delivery metrics, fixing the tenant URL, and using redriveDeadDeliveries",
  unavailableProof: "apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts",
} as const;

// ---------------------------------------------------------------------------
// HTTP webhook dispatcher (ADR-0051). A single bounded POST attempt (the async
// retry worker owns backoff/dead-letter). Network/timeout failures are classified, never thrown;
// the signing secret lives only in the caller-supplied signature header, never logged.
// ---------------------------------------------------------------------------
export class HttpWebhookDispatcher implements WebhookDispatchPort {
  private readonly fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async dispatch(req: WebhookDispatchRequest): Promise<WebhookDispatchResult> {
    try {
      const res = await this.fetchImpl(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(WEBHOOK_RETRY_POLICY.timeoutMs),
      });
      return {
        ok: res.ok,
        status: res.status,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        error: err instanceof Error ? err.message : "dispatch failed",
      };
    }
  }
}
