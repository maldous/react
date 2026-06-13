// ---------------------------------------------------------------------------
// Provider readiness probe port (ADR-0071 / ADR-ACT-0271) — composed providers.
//
// A capability-agnostic readiness probe for a composed provider (Meilisearch,
// Prometheus, Tempo, Alertmanager, Windmill, Temporal, …). It answers ONE honest
// question — is this provider's backend reachable and healthy RIGHT NOW — by hitting
// the provider's own health endpoint. The result feeds the provider-config plane's
// adapter-confirmed lifecycle (deriveReadinessLifecycle, ADR-0070): a configured
// provider is `ready` ONLY when its probe says ready. Never faked.
//
// `not_configured` when no endpoint is wired; `degraded` when wired but the backend
// is unreachable/unhealthy; `ready` only on a healthy live response. No secret value
// (e.g. an API key/master key) is ever returned in the result.
// ---------------------------------------------------------------------------

export type ProviderReadinessStatus = "ready" | "degraded" | "not_configured";

export interface ProviderReadinessResult {
  /** Concrete provider key, e.g. "meilisearch" | "prometheus". */
  provider: string;
  /** The USF capability this provider serves, e.g. "search-indexing". */
  capability: string;
  status: ProviderReadinessStatus;
  /** Safe, non-secret human detail (endpoint host + health verdict). */
  detail: string;
}

export interface ProviderReadinessProbe {
  probe(): Promise<ProviderReadinessResult>;
}
