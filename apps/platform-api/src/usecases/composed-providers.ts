// ---------------------------------------------------------------------------
// Composed provider readiness (ADR-0071 / ADR-ACT-0271).
//
// A single operator surface that probes every composed provider's health endpoint
// live and reports an honest readiness + adapter-confirmed lifecycle. This is the
// readiness spine the provider-config plane (ADR-0070) consumes: a configured
// provider is `ready` ONLY when its live probe says ready (deriveReadinessLifecycle).
//
// The probe registry is ENV-driven. Providers with a wired endpoint are probed; those
// without one report `not_configured` (never faked). No secret (master key/token) is
// ever returned — auth headers are sent to the backend but never echoed.
// ---------------------------------------------------------------------------

import type { ComposedProviderReadinessResponse } from "@platform/contracts-admin";
import { HttpProviderReadinessProbe } from "../adapters/http-provider-readiness-probe.ts";
import type { ProviderReadinessProbe } from "../ports/provider-readiness-probe.ts";
import { deriveReadinessLifecycle } from "./provider-config.ts";

interface ProbeSpec {
  provider: string;
  capability: string;
  /** Resolved health URL (env-driven), or null when not configured. */
  healthUrl: string | null;
  authHeader?: { name: string; value: string };
  okBody?: (t: string) => boolean;
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== "" ? v.trim() : undefined;
};
const join = (base: string | undefined, path: string): string | null =>
  base ? base.replace(/\/+$/, "") + path : null;

/**
 * The composed-provider probe specs (ADR-0056 deployment ladder). Light providers
 * (Meilisearch/Prometheus/Alertmanager) default to their local ports so a brought-up
 * container probes `ready`; heavier providers (Tempo/Windmill/Temporal) probe only
 * when explicitly wired (no default ⇒ `not_configured`, honest).
 */
function probeSpecs(): ProbeSpec[] {
  const meiliKey = env("MEILISEARCH_API_KEY");
  return [
    {
      provider: "meilisearch",
      capability: "search-indexing",
      healthUrl: join(env("MEILISEARCH_URL") ?? "http://localhost:7700", "/health"),
      okBody: (t) => /available/i.test(t),
      ...(meiliKey ? { authHeader: { name: "Authorization", value: `Bearer ${meiliKey}` } } : {}),
    },
    {
      provider: "prometheus",
      capability: "metrics-traces",
      healthUrl: join(env("PROMETHEUS_URL") ?? "http://localhost:9090", "/-/ready"),
    },
    {
      provider: "tempo",
      capability: "metrics-traces",
      healthUrl: join(env("TEMPO_URL"), "/ready"),
    },
    {
      provider: "alertmanager",
      capability: "alerting-incident-oncall",
      healthUrl: join(env("ALERTMANAGER_URL") ?? "http://localhost:9093", "/-/ready"),
    },
    {
      provider: "windmill",
      capability: "workflow-engine-scheduled-jobs",
      healthUrl: join(env("WINDMILL_URL"), "/api/version"),
    },
    {
      provider: "temporal",
      capability: "workflow-engine-scheduled-jobs",
      healthUrl: join(env("TEMPORAL_HTTP_URL"), "/"),
    },
  ];
}

function buildProbe(spec: ProbeSpec): ProviderReadinessProbe {
  return new HttpProviderReadinessProbe({
    provider: spec.provider,
    capability: spec.capability,
    healthUrl: spec.healthUrl,
    authHeader: spec.authHeader,
    okBody: spec.okBody,
  });
}

/** Probe every composed provider live and report readiness + adapter-confirmed lifecycle. */
export async function getComposedProviderReadiness(
  specs: ProbeSpec[] = probeSpecs()
): Promise<ComposedProviderReadinessResponse> {
  const results = await Promise.all(
    specs.map(async (spec) => {
      const r = await buildProbe(spec).probe();
      // not_configured ⇒ candidate; otherwise the probe confirms ready/degraded.
      const lifecycle =
        r.status === "not_configured"
          ? "candidate"
          : deriveReadinessLifecycle(
              { lifecycleState: "configured" },
              { status: r.status === "ready" ? "ready" : "degraded" }
            );
      return {
        provider: r.provider,
        capability: r.capability,
        status: r.status,
        lifecycleState: lifecycle,
        detail: r.detail,
      };
    })
  );
  return { providers: results };
}
