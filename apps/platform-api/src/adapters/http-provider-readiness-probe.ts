/**
 * HttpProviderReadinessProbe (ADR-0071 / ADR-ACT-0271) — generic composed-provider probe.
 *
 * One probe for every HTTP-health composed provider: it GETs the provider's health
 * endpoint with the global `fetch` (NO new npm dependency) and classifies honestly:
 *   - not_configured : no endpoint wired (env unset) — never probed, never faked;
 *   - ready          : the health endpoint answered with a 2xx (and, if given, the
 *                      okBody predicate matched);
 *   - degraded       : wired but unreachable / non-2xx / body predicate failed.
 *
 * The `detail` carries only the endpoint HOST + a verdict — never a token, master
 * key, or path that could leak a secret. Any auth header (provider API key) is sent
 * but NEVER echoed into the result.
 */

import type {
  ProviderReadinessProbe,
  ProviderReadinessResult,
} from "../ports/provider-readiness-probe.ts";

type FetchImpl = typeof fetch;

export interface HttpProviderReadinessOptions {
  provider: string;
  capability: string;
  /** Provider configuration source; callers usually pass URLs loaded from process.env. */
  configSource?: string;
  /** Full health URL, or null/empty when the provider is not configured. */
  healthUrl: string | null | undefined;
  /** Optional auth header value (e.g. Meilisearch master key, Vault token). Never logged. */
  authHeader?: { name: string; value: string };
  /** Optional predicate over the (already size-bounded) response body text. */
  okBody?: (bodyText: string) => boolean;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  maxAttempts?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "configured-endpoint";
  }
}

export const httpProviderReadinessProbeReliabilityEvidence = {
  configSource:
    "healthUrl and optional authHeader are provided by composed-providers from process.env-backed provider configuration",
  retry: "probe retries one additional bounded health attempt by default before reporting degraded",
  degradedMode:
    "unconfigured endpoints return not_configured; failed configured endpoints return degraded with host-only detail",
  failClosed:
    "provider readiness never reports ready unless a configured health endpoint returns 2xx and the optional body predicate passes",
  fallbackRationale:
    "no fallback readiness source is used because adapter-confirmed lifecycle must reflect the live provider health check",
  operatorRecovery:
    "operators recover by wiring or correcting the provider healthUrl/authHeader configuration and rerunning readiness",
};

export class HttpProviderReadinessProbe implements ProviderReadinessProbe {
  private readonly opts: HttpProviderReadinessOptions;
  private readonly fetchImpl: FetchImpl;
  constructor(opts: HttpProviderReadinessOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async probe(): Promise<ProviderReadinessResult> {
    const { provider, capability, healthUrl } = this.opts;
    if (!healthUrl) {
      return {
        provider,
        capability,
        status: "not_configured",
        detail: "no endpoint wired (provider not configured)",
      };
    }
    const host = hostOf(healthUrl);
    const headers: Record<string, string> = {};
    if (this.opts.authHeader) headers[this.opts.authHeader.name] = this.opts.authHeader.value;
    const maxAttempts = Math.max(1, this.opts.maxAttempts ?? 2);
    let lastDetail = `${host} unreachable`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs ?? 2500);
      try {
        const res = await this.fetchImpl(healthUrl, { headers, signal: ac.signal });
        if (!res.ok) {
          lastDetail = `${host} health ${res.status}`;
          continue;
        }
        if (this.opts.okBody) {
          const text = (await res.text()).slice(0, 4096);
          if (!this.opts.okBody(text)) {
            lastDetail = `${host} health body not ok`;
            continue;
          }
        }
        return { provider, capability, status: "ready", detail: `${host} reachable (health 2xx)` };
      } catch {
        lastDetail = `${host} unreachable`;
      } finally {
        clearTimeout(timer);
      }
    }
    return { provider, capability, status: "degraded", detail: lastDetail };
  }
}
