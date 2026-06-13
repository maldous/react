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
  /** Full health URL, or null/empty when the provider is not configured. */
  healthUrl: string | null | undefined;
  /** Optional auth header value (e.g. Meilisearch master key, Vault token). Never logged. */
  authHeader?: { name: string; value: string } | undefined;
  /** Optional predicate over the (already size-bounded) response body text. */
  okBody?: ((bodyText: string) => boolean) | undefined;
  fetchImpl?: FetchImpl | undefined;
  timeoutMs?: number | undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "configured-endpoint";
  }
}

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
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs ?? 2500);
    try {
      const res = await this.fetchImpl(healthUrl, { headers, signal: ac.signal });
      if (!res.ok) {
        return { provider, capability, status: "degraded", detail: `${host} health ${res.status}` };
      }
      if (this.opts.okBody) {
        const text = (await res.text()).slice(0, 4096);
        if (!this.opts.okBody(text)) {
          return { provider, capability, status: "degraded", detail: `${host} health body not ok` };
        }
      }
      return { provider, capability, status: "ready", detail: `${host} reachable (health 2xx)` };
    } catch {
      return { provider, capability, status: "degraded", detail: `${host} unreachable` };
    } finally {
      clearTimeout(timer);
    }
  }
}
