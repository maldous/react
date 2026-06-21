// ---------------------------------------------------------------------------
// Billing readiness seam (Phase 9 / v2 readiness).
//
// This is a conservative reporting seam only. It does not implement billing
// lifecycle, invoicing or payments. It classifies the current billing boundary
// so operator tooling can see whether the platform is still in a built-in-only
// state or has a live composed engine wired.
// ---------------------------------------------------------------------------

export type BillingBoundaryStatus = "not_configured" | "configured" | "unreachable";

export interface BillingBoundaryReadiness {
  status: BillingBoundaryStatus;
  provider: "built-in" | "lago" | "killbill";
  endpoint: string | null;
  metrics: "prometheus" | "not_configured";
  traces: "tempo" | "not_configured";
  logs: "loki" | "not_configured";
  errorCapture: "sentry" | "not_configured";
  meteringReady: boolean;
  entitlementsReady: boolean;
  summary: string;
}

export async function getBillingBoundaryReadiness(): Promise<BillingBoundaryReadiness> {
  const provider =
    (process.env["BILLING_PROVIDER"] as "built-in" | "lago" | "killbill") ?? "built-in";
  const endpoint = process.env["BILLING_URL"] ?? null;
  const meteringReady = true;
  const entitlementsReady = true;

  if (!endpoint) {
    return {
      status: "not_configured",
      provider,
      endpoint: null,
      metrics: "not_configured",
      traces: "not_configured",
      logs: "not_configured",
      errorCapture: "not_configured",
      meteringReady,
      entitlementsReady,
      summary:
        provider === "built-in"
          ? "Billing engine not configured; platform remains on the built-in boundary."
          : `Billing provider ${provider} is selected but no endpoint is wired.`,
    };
  }

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(endpoint, { signal: ac.signal }).finally(() => clearTimeout(t));
    return {
      status: res.ok ? "configured" : "unreachable",
      provider,
      endpoint,
      metrics: "prometheus",
      traces: "tempo",
      logs: "loki",
      errorCapture: "sentry",
      meteringReady,
      entitlementsReady,
      summary: res.ok
        ? `Billing provider ${provider} is reachable.`
        : `Billing provider ${provider} responded with ${res.status}.`,
    };
  } catch {
    return {
      status: "unreachable",
      provider,
      endpoint,
      metrics: "prometheus",
      traces: "tempo",
      logs: "loki",
      errorCapture: "sentry",
      meteringReady,
      entitlementsReady,
      summary: `Billing provider ${provider} could not be reached.`,
    };
  }
}
