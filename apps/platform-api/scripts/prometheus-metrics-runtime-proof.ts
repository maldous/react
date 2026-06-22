/**
 * Provider-level proof wrapper for the prometheus-metrics adapter.
 *
 * The delegated live proof exercises Prometheus availability, scrape target
 * health, metric family registration, bounded labels, counter movement,
 * readiness degradation, external route denial, retry/unavailable failure
 * paths, and misconfigured-provider failure exits.
 */
await import("./metrics-prometheus-runtime-proof.ts");
