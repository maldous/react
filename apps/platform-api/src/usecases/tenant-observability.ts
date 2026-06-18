import { buildLogQL, type LogSearchQuery, type LogSearchResult } from "@platform/adapters-loki";
import type {
  ObservabilitySignalStatus,
  TenantObservabilityReadinessResponse,
  TenantObservabilityReadinessStatus,
} from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Tenant observability readiness (ADR-0050 / ADR-ACT-0219)
//
// Read-only readiness over the existing Loki log-search plumbing. The live check
// is a bounded, tenant-scoped log query; the high-cardinality-label guard is
// asserted structurally so the low-cardinality (service/level → labels) vs
// high-cardinality (tenant/trace/request ids → `| json` filters) split cannot
// silently regress. No log line, label value, or tenant data is ever returned —
// only signal statuses. Readiness is never faked.
// ---------------------------------------------------------------------------

const HIGH_CARDINALITY_KEYS = ["organisationId", "traceId", "tenantId", "requestId", "actorId"];

/**
 * Pure structural guard (ADR-0020/ADR-0029): low-cardinality `service`/`level`
 * must be Loki LABELS (inside the `{...}` selector); high-cardinality ids must be
 * `| json` field filters, never labels. Returns false if that ever regresses.
 */
export function assertHighCardinalityGuard(): boolean {
  const ql = buildLogQL({
    service: "api",
    level: "error",
    organisationId: "o",
    traceId: "t",
    tenantId: "tn",
    requestId: "r",
    actorId: "a",
  });
  const selectorEnd = ql.indexOf("}");
  if (selectorEnd < 0) return false;
  const selector = ql.slice(0, selectorEnd + 1);
  const lowAreLabels = selector.includes("service=") && selector.includes("level=");
  const highAreJsonFilters =
    ql.includes("| json") &&
    HIGH_CARDINALITY_KEYS.every((k) => !selector.includes(k) && ql.includes(`${k}=`));
  return lowAreLabels && highAreJsonFilters;
}

export interface ObservabilityProbePort {
  search(query: LogSearchQuery): Promise<LogSearchResult>;
}

/**
 * Honest reachability probes for the surrounding observability infra. Each returns a
 * signal status; the route wires real timeout-bounded HTTP probes, tests inject fakes.
 * A service that is not wired returns `not_configured`; one with no local backend
 * returns `not_applicable` — never `ok`.
 */
export interface ObservabilityInfraProbes {
  probeMetrics(): Promise<ObservabilitySignalStatus>;
  probeOtelCollector(): Promise<ObservabilitySignalStatus>;
  probeDashboards(): Promise<ObservabilitySignalStatus>;
  probeErrorCapture(): Promise<ObservabilitySignalStatus>;
}

export interface ObservabilityReadinessDeps {
  organisationId: string;
  /** A bounded log-query port (the route wires a timeout-guarded Loki adapter). */
  port: ObservabilityProbePort;
  /** Optional infra reachability probes; omitted in minimal/unit contexts. */
  infra?: ObservabilityInfraProbes;
  /** Current time; injected for deterministic tests. */
  now?: Date;
}

function boundedWindow(now: Date): { start: string; end: string } {
  const end = now.getTime();
  const start = end - 5 * 60 * 1000; // last 5 minutes
  return { start: `${start}000000`, end: `${end}000000` }; // unix-ns strings for Loki
}

/** `GET /api/org/observability/readiness` — bounded live probe; never faked. */
export async function getTenantObservabilityReadiness(
  deps: ObservabilityReadinessDeps
): Promise<TenantObservabilityReadinessResponse> {
  const highCardinalityGuard = assertHighCardinalityGuard();
  const window = boundedWindow(deps.now ?? new Date());

  let logIngestion: ObservabilitySignalStatus;
  let tenantScopedQuery: ObservabilitySignalStatus;

  try {
    await deps.port.search({ limit: 1, direction: "backward", ...window });
    logIngestion = "ok";
  } catch {
    logIngestion = "unreachable";
  }

  if (logIngestion === "ok") {
    try {
      await deps.port.search({
        organisationId: deps.organisationId,
        limit: 1,
        direction: "backward",
        ...window,
      });
      tenantScopedQuery = "ok";
    } catch {
      tenantScopedQuery = "unreachable";
    }
  } else {
    tenantScopedQuery = "unknown";
  }

  const status = classifyObservability({ logIngestion, tenantScopedQuery, highCardinalityGuard });

  // Surrounding-infra signals are informational (reported, never faked) and do NOT
  // downgrade the core status below `configured` when logs are healthy — they are
  // optional infra, surfaced so operators can see what is reachable.
  const infraSignals: [
    ObservabilitySignalStatus,
    ObservabilitySignalStatus,
    ObservabilitySignalStatus,
    ObservabilitySignalStatus,
  ] = deps.infra
    ? await Promise.all([
        deps.infra.probeMetrics(),
        deps.infra.probeOtelCollector(),
        deps.infra.probeDashboards(),
        deps.infra.probeErrorCapture(),
      ])
    : ["unknown", "unknown", "unknown", "unknown"];
  const [metrics, otelCollector, dashboards, errorCapture] = infraSignals;

  return {
    status,
    logIngestion,
    tenantScopedQuery,
    metrics,
    // Trace/log correlation needs a trace backend (none locally) — honestly not applicable.
    traceCorrelation: "not_applicable",
    otelCollector,
    dashboards,
    errorCapture,
    highCardinalityGuard,
  };
}

/** Pure classifier — exported for unit tests. */
export function classifyObservability(s: {
  logIngestion: ObservabilitySignalStatus;
  tenantScopedQuery: ObservabilitySignalStatus;
  highCardinalityGuard: boolean;
}): TenantObservabilityReadinessStatus {
  if (!s.highCardinalityGuard) return "degraded"; // the label model regressed
  if (s.logIngestion === "unreachable") return "provider_unreachable";
  if (s.logIngestion === "ok" && s.tenantScopedQuery === "ok") return "configured";
  if (s.logIngestion === "ok") return "degraded"; // reachable but tenant query unhealthy
  return "unknown";
}
