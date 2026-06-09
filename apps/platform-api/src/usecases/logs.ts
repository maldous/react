import type { LogSearchQuery, LogSearchResult } from "@platform/adapters-loki";

/**
 * Admin log search use case (ADR-0035, ADR-ACT-0194).
 *
 * Pure orchestration over an injected Loki log-query port. Clamps the result
 * limit to a safe bound and normalises the direction so a malformed query
 * parameter cannot drive an unbounded or invalid Loki request.
 */

export interface LogSearchPort {
  search(query: LogSearchQuery): Promise<LogSearchResult>;
}

export interface LogSearchDeps {
  loki: LogSearchPort;
}

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

export function normaliseLogSearchQuery(input: LogSearchQuery): LogSearchQuery {
  const limit = Number.isFinite(input.limit)
    ? Math.min(Math.max(1, Math.floor(input.limit as number)), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const direction = input.direction === "forward" ? "forward" : "backward";
  return { ...input, limit, direction };
}

export async function searchLogs(
  input: LogSearchQuery,
  deps: LogSearchDeps
): Promise<LogSearchResult> {
  return deps.loki.search(normaliseLogSearchQuery(input));
}
