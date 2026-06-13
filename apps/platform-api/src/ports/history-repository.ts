// ---------------------------------------------------------------------------
// History repository port (ADR-0063 / ADR-ACT-0272) — read-only history projection.
//
// A UNION read-model over EXISTING tenant-scoped sources (audit_events,
// platform_events, notification_log, incidents, meter_events). It introduces NO new
// store and duplicates NO data — it is a read-only projection that resolves the
// data-duplication design gap recorded in the earlier pass. Tenant-scoped (each source
// filtered by the organisation); operators may query a selected tenant. Pagination is
// required. Secret-bearing columns (metadata/payload) are NEVER projected — only safe
// summary fields (type/title/timestamp/actor).
// ---------------------------------------------------------------------------

export type HistorySourceType = "audit" | "event" | "notification" | "incident" | "meter";

export const HISTORY_SOURCE_TYPES: readonly HistorySourceType[] = [
  "audit",
  "event",
  "notification",
  "incident",
  "meter",
];

export interface HistoryEntry {
  id: string;
  source: HistorySourceType;
  /** Safe classifier: action / event_type / category / status / meter_key. */
  type: string;
  /** Safe human summary built from non-secret columns only. */
  title: string;
  occurredAt: string | null;
  actorId: string | null;
}

export interface HistoryQuery {
  organisationId: string;
  limit: number;
  offset: number;
  /** Restrict to these source types; empty/undefined ⇒ all. */
  sources?: HistorySourceType[];
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface HistoryRepository {
  query(q: HistoryQuery): Promise<HistoryPage>;
}
