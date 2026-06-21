import type { BillingEngineReadiness } from "../ports/billing-provider.ts";
import { getBillingBoundaryReadiness } from "./billing-readiness.ts";

export interface BillingControlReport {
  provider: "lago" | "killbill" | "built-in";
  readiness: BillingEngineReadiness;
  observability: {
    metrics: "prometheus" | "not_configured";
    traces: "tempo" | "not_configured";
    logs: "loki" | "not_configured";
    errorCapture: "sentry" | "not_configured";
  };
  surfaces: {
    products: "planned";
    plans: "planned";
    subscriptions: "planned";
    invoices: "planned";
    usage: "planned";
    dunning: "planned";
  };
  ready: boolean;
  summary: string;
}

export async function getBillingControlReport(): Promise<BillingControlReport> {
  const readiness = await getBillingBoundaryReadiness();
  const provider = readiness.provider === "built-in" ? "built-in" : readiness.provider;
  return {
    provider,
    readiness: {
      status:
        readiness.status === "not_configured"
          ? "unavailable"
          : readiness.status === "configured"
            ? "ready"
            : "degraded",
      detail: readiness.summary,
    },
    observability: {
      metrics: readiness.metrics,
      traces: readiness.traces,
      logs: readiness.logs,
      errorCapture: readiness.errorCapture,
    },
    surfaces: {
      products: "planned",
      plans: "planned",
      subscriptions: "planned",
      invoices: "planned",
      usage: "planned",
      dunning: "planned",
    },
    ready: readiness.status === "configured",
    summary:
      provider === "built-in"
        ? "Billing engine not yet wired; platform billing surfaces are still planned."
        : `Billing provider ${provider} is exposed at the platform boundary.`,
  };
}
