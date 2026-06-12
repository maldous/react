/**
 * LocalRoutingProbePort — live LOCAL reverse-proxy routing probe (ADR-ACT-0232).
 *
 * Answers: does this domain, sent through the LOCAL proxy (Caddy web profile),
 * reach the EXPECTED tenant context? Implementations must perform a real
 * request; returning tenantContextMatched=true from stored state is forbidden
 * (no fake readiness). Public routing is out of scope for this port.
 */
export interface LocalRoutingProbeResult {
  /** The local proxy returned an HTTP response for the probed host. */
  reachable: boolean;
  /** The response proved the EXPECTED tenant context (not apex/another tenant). */
  tenantContextMatched: boolean;
}

export interface LocalRoutingProbePort {
  probe(domain: string, expectedSlug: string): Promise<LocalRoutingProbeResult>;
}
