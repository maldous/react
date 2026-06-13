// ---------------------------------------------------------------------------
// History usecase (ADR-0063 / ADR-ACT-0272) — read-only history projection.
//
// A read-only query over the HistoryRepository UNION projection. No mutation, no audit
// (reading history is not itself an audited action — the underlying audit_events rows
// already record the audited actions). Tenant-scoped: the organisationId is the
// session tenant for /api/org/history, or the operator-selected tenant for the admin
// route. Pagination is required; secret-bearing source columns are never projected.
// ---------------------------------------------------------------------------

import type { HistoryPageResponse, HistorySourceType } from "@platform/contracts-admin";
import type { HistoryRepository } from "../ports/history-repository.ts";

export interface HistoryDeps {
  history: HistoryRepository;
}

export async function getHistory(
  organisationId: string,
  opts: { limit?: number; offset?: number; sources?: HistorySourceType[] },
  deps: HistoryDeps
): Promise<HistoryPageResponse> {
  const page = await deps.history.query({
    organisationId,
    limit: opts.limit ?? 50,
    offset: opts.offset ?? 0,
    sources: opts.sources,
  });
  return {
    entries: page.entries,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}
