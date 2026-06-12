import {
  WEBHOOK_RETRY_POLICY,
  type WebhookDispatchPort,
  type WebhookDispatchRequest,
  type WebhookDispatchResult,
} from "../usecases/webhooks.ts";

// ---------------------------------------------------------------------------
// HTTP webhook dispatcher (ADR-0051). A single bounded POST attempt (the async
// retry worker is deferred). Network/timeout failures are classified, never thrown;
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
