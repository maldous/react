/**
 * PostgresHistoryRepository (ADR-0063 / ADR-ACT-0272) — read-only history projection.
 *
 * A UNION ALL read-model over the existing tenant-scoped tables. NO new store, NO
 * duplicated data, NO mutation — SELECT only. Every branch is filtered by the
 * organisation (audit_events uses tenant_id::text; the others organisation_id::uuid;
 * the tenant's organisationId string satisfies both). Only safe summary columns are
 * projected — metadata/payload (which may carry arbitrary content) are NEVER selected.
 *
 * Runs under withSystemAdmin with an explicit organisation predicate on every branch:
 * the explicit filter is the tenant-isolation guarantee (a query for org A can never
 * return org B's rows), equivalent to RLS for this read-only projection and immune to
 * the differing tenant-column names across the source tables.
 */

import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  HistoryEntry,
  HistoryPage,
  HistoryQuery,
  HistoryRepository,
  HistorySourceType,
} from "../ports/history-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

// Each branch projects (id, source, type, title, occurred_at, actor_id) from SAFE
// columns only. $1 = organisationId (text for audit; ::uuid for the rest).
const BRANCHES: Record<HistorySourceType, string> = {
  audit:
    "SELECT id::text AS id, 'audit' AS source, action AS type, " +
    "(action || COALESCE(' ' || resource, '')) AS title, timestamp AS occurred_at, actor_id " +
    "FROM public.audit_events WHERE tenant_id = $1",
  event:
    "SELECT id::text AS id, 'event' AS source, event_type AS type, " +
    "(event_type || ' [' || status || ']') AS title, created_at AS occurred_at, NULL::text AS actor_id " +
    "FROM public.platform_events WHERE organisation_id = $1::uuid",
  notification:
    "SELECT id::text AS id, 'notification' AS source, category AS type, " +
    "(channel || ' ' || category || ' [' || status || ']') AS title, created_at AS occurred_at, user_id AS actor_id " +
    "FROM public.notification_log WHERE organisation_id = $1::uuid",
  incident:
    "SELECT id::text AS id, 'incident' AS source, status AS type, " +
    "title AS title, opened_at AS occurred_at, updated_by AS actor_id " +
    "FROM public.incidents WHERE organisation_id = $1::uuid",
  meter:
    "SELECT id::text AS id, 'meter' AS source, meter_key AS type, " +
    "meter_key AS title, occurred_at AS occurred_at, subject_id AS actor_id " +
    "FROM public.meter_events WHERE organisation_id = $1::uuid",
};

interface Row {
  id: string;
  source: HistorySourceType;
  type: string;
  title: string;
  occurred_at: Date | string | null;
  actor_id: string | null;
}

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

export class PostgresHistoryRepository implements HistoryRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async query(q: HistoryQuery): Promise<HistoryPage> {
    const wanted = q.sources?.length ? q.sources : (Object.keys(BRANCHES) as HistorySourceType[]);
    const union = wanted.map((s) => BRANCHES[s]).join("\n  UNION ALL\n  ");
    const limit = Math.min(Math.max(q.limit, 1), 200);
    const offset = Math.max(q.offset, 0);

    return withSystemAdmin(this.pool as never, async (client) => {
      const totalRes = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (\n  ${union}\n) h`,
        [q.organisationId]
      );
      const total = Number(totalRes.rows[0]?.n ?? 0);
      const pageRes = await client.query<Row>(
        `SELECT id, source, type, title, occurred_at, actor_id FROM (\n  ${union}\n) h ` +
          `ORDER BY occurred_at DESC NULLS LAST LIMIT $2 OFFSET $3`,
        [q.organisationId, limit, offset]
      );
      const entries: HistoryEntry[] = pageRes.rows.map((r) => ({
        id: r.id,
        source: r.source,
        type: r.type,
        title: r.title,
        occurredAt: iso(r.occurred_at),
        actorId: r.actor_id,
      }));
      return { entries, total, limit, offset };
    });
  }
}
