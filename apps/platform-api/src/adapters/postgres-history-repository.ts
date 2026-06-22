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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgClient = { query<T = any>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };

export interface PostgresHistoryProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

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

export function loadPostgresHistoryProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresHistoryProviderConfig {
  return {
    statementTimeoutMs: Number(env["HISTORY_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["HISTORY_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["HISTORY_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresHistoryRepository implements HistoryRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresHistoryProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresHistoryProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresHistoryProviderConfig(),
      ...config,
    };
  }

  async query(q: HistoryQuery): Promise<HistoryPage> {
    return this.withRetry(async () => {
      const wanted = q.sources?.length ? q.sources : (Object.keys(BRANCHES) as HistorySourceType[]);
      const union = wanted.map((s) => BRANCHES[s]).join("\n  UNION ALL\n  ");
      const limit = Math.min(Math.max(q.limit, 1), 200);
      const offset = Math.max(q.offset, 0);

      return withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
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
    });
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-history-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN (
                'audit_events',
                'platform_events',
                'notification_log',
                'incidents',
                'meter_events'
              )
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-history-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migrations for audit/events/notifications/incidents/meter tables, inspect history source table grants, then retry the read-only history query";
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.providerConfig.retryAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt >= this.providerConfig.retryAttempts) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.providerConfig.retryBackoffMs * (attempt + 1))
        );
      }
    }
    throw new Error(
      `postgres-history-repository unavailable; no fallback is allowed for tenant history projection, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
