import type { LogSearchFilters } from "./admin-logs-client";
import type { LogSearchParams, LogRange } from "./admin-logs.schema";

// Pure mapping between the bookmarkable URL/filter state and the BFF query
// shape. Kept out of components so the delivery layer stays thin (ADR-0001).

const RANGE_MS: Record<LogRange, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

const FILTER_KEYS = [
  "service",
  "level",
  "requestId",
  "traceId",
  "tenantId",
  "actorId",
  "organisationId",
  "text",
] as const;

/**
 * Build the BFF query from URL params. `now` is passed in (captured once per
 * search) so the derived start/end are stable for the TanStack Query key and do
 * not drift on every render.
 */
export function paramsToBffFilters(params: LogSearchParams, now: number): LogSearchFilters {
  const ms = RANGE_MS[params.range];
  const filters: LogSearchFilters = {
    start: new Date(now - ms).toISOString(),
    end: new Date(now).toISOString(),
    limit: params.limit,
    direction: params.direction,
  };
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      filters[key] = value.trim();
    }
  }
  return filters;
}

/** True when the operator has set at least one substantive filter. */
export function hasActiveFilters(params: LogSearchParams): boolean {
  return FILTER_KEYS.some((k) => {
    const v = params[k];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/**
 * Operator-shareable reproduction context: the stable URL plus the resolved
 * filter params. Copying this lets a colleague reopen the exact same search.
 */
export function buildQueryContext(params: LogSearchParams, url: string): string {
  return JSON.stringify({ url, params }, null, 2);
}
