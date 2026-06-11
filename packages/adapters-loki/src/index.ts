export const packageName = "@platform/adapters-loki";

// ---------------------------------------------------------------------------
// Loki log-query adapter (ADR-0035, ADR-ACT-0194)
//
// Read-only structured log search over the Loki HTTP query_range API.
//
// Label policy (ADR-0035): only low-cardinality fields are Loki labels
// (`service`, `level`). High-cardinality fields (requestId, traceId, tenantId,
// actorId, organisationId) are NOT labels — they are queried via `| json`
// structured-metadata filters so the Loki index does not bloat.
// ---------------------------------------------------------------------------

export interface LokiConfig {
  /** Base Loki URL, e.g. http://loki:3100 (no trailing /loki/api/...). */
  url?: string;
}

export interface LogSearchQuery {
  // Low-cardinality → Loki labels
  service?: string;
  level?: string;
  // High-cardinality → `| json` field filters
  requestId?: string;
  traceId?: string;
  tenantId?: string;
  actorId?: string;
  organisationId?: string;
  // Free-text line filter
  text?: string;
  // Time range — RFC3339 or unix-ns strings as accepted by Loki query_range
  start?: string;
  end?: string;
  limit?: number;
  direction?: "forward" | "backward";
}

export interface LogEntry {
  /** ISO-8601 timestamp derived from the Loki nanosecond timestamp. */
  timestamp: string;
  /** Raw log line as stored in Loki. */
  line: string;
  /** Parsed JSON fields when the line is structured JSON; otherwise empty. */
  fields: Record<string, unknown>;
  /** Stream labels (service, level, …). */
  labels: Record<string, string>;
}

export interface LogSearchResult {
  entries: LogEntry[];
}

/** High-cardinality fields queried via `| json | field="value"` (never labels). */
const JSON_FILTER_KEYS = ["requestId", "traceId", "tenantId", "actorId", "organisationId"] as const;

function escapeForQuotes(value: string): string {
  // Escape backslashes first, then double quotes, for LogQL string literals.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build a LogQL query from structured search criteria. Pure and deterministic
 * so it can be unit-tested without a Loki instance.
 */
export function buildLogQL(query: LogSearchQuery): string {
  const labelMatchers: string[] = [];
  if (query.service) labelMatchers.push(`service="${escapeForQuotes(query.service)}"`);
  if (query.level) labelMatchers.push(`level="${escapeForQuotes(query.level)}"`);

  // Loki requires at least one matcher that is guaranteed to match something;
  // fall back to "service present" when no label filter was supplied.
  const selector = labelMatchers.length > 0 ? `{${labelMatchers.join(", ")}}` : `{service=~".+"}`;

  let expr = selector;

  if (query.text) {
    expr += ` |= "${escapeForQuotes(query.text)}"`;
  }

  const jsonFilters = JSON_FILTER_KEYS.filter((k) => query[k]).map(
    (k) => `${k}="${escapeForQuotes(String(query[k]))}"`
  );
  if (jsonFilters.length > 0) {
    expr += ` | json | ${jsonFilters.join(" | ")}`;
  }

  return expr;
}

interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>;
}

interface LokiQueryResponse {
  status?: string;
  data?: { resultType?: string; result?: LokiStream[] };
}

/**
 * Parse a Loki query_range response into flat, time-sorted log entries.
 * Exported for unit testing. Newest entries first.
 */
export function parseLokiResponse(body: unknown): LogEntry[] {
  const streams = (body as LokiQueryResponse)?.data?.result ?? [];
  const entries: LogEntry[] = [];
  for (const stream of streams) {
    const labels = stream.stream ?? {};
    for (const [tsNanos, line] of stream.values ?? []) {
      let fields: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object") fields = parsed as Record<string, unknown>;
      } catch {
        // Non-JSON line (e.g. Caddy/Keycloak plain text) — leave fields empty.
      }
      entries.push({
        timestamp: nanosToIso(tsNanos),
        line,
        fields,
        labels,
      });
    }
  }
  // Newest first.
  entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return entries;
}

function nanosToIso(tsNanos: string): string {
  const ms = Math.floor(Number(tsNanos) / 1_000_000);
  if (!Number.isFinite(ms)) return tsNanos;
  return new Date(ms).toISOString();
}

export class LokiLogQueryAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LokiConfig = {}, fetchImpl: typeof fetch = fetch) {
    // Strip trailing slashes without a backtracking regex (avoids polynomial-time ReDoS).
    let url = config.url ?? "http://localhost:3100";
    while (url.endsWith("/")) url = url.slice(0, -1);
    this.baseUrl = url;
    this.fetchImpl = fetchImpl;
  }

  async search(query: LogSearchQuery): Promise<LogSearchResult> {
    const params = new URLSearchParams({
      query: buildLogQL(query),
      limit: String(query.limit ?? 100),
      direction: query.direction ?? "backward",
    });
    if (query.start) params.set("start", query.start);
    if (query.end) params.set("end", query.end);

    const res = await this.fetchImpl(
      `${this.baseUrl}/loki/api/v1/query_range?${params.toString()}`
    );
    if (!res.ok) {
      throw new Error(`Loki query failed: ${res.status}`);
    }
    const body = await res.json();
    return { entries: parseLokiResponse(body) };
  }
}

export function createLokiLogQueryAdapter(
  config: LokiConfig = {},
  fetchImpl: typeof fetch = fetch
): LokiLogQueryAdapter {
  return new LokiLogQueryAdapter(config, fetchImpl);
}
