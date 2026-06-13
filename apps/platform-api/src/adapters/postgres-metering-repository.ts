/**
 * PostgresMeteringRepository (ADR-0067 / ADR-ACT-0256).
 *
 * Backed by public.meter_events (migration 024), RLS-enabled. Idempotent inserts
 * via the (organisation_id, meter_key, idempotency_key) unique constraint +
 * ON CONFLICT DO NOTHING. Tenant self-aggregation uses withTenant (RLS-scoped);
 * recording + operator aggregation use withSystemAdmin (rls_bypass). No secrets.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { QuotaWindow } from "@platform/contracts-admin";
import type { MeteringRepository, RecordMeterEventInput } from "../ports/metering-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

// Window → time predicate. Window comes from a fixed enum (never user free-text).
const WINDOW_SQL: Record<QuotaWindow, string> = {
  daily: "occurred_at >= date_trunc('day', now())",
  monthly: "occurred_at >= date_trunc('month', now())",
  rolling_30d: "occurred_at >= now() - interval '30 days'",
  lifetime: "true",
};

export class PostgresMeteringRepository implements MeteringRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async record(
    input: RecordMeterEventInput
  ): Promise<{ recorded: boolean; deduplicated: boolean }> {
    const metadata = JSON.stringify(input.metadata ?? {});
    const result = await withSystemAdmin(this.pool as never, async (client) => {
      return client.query(
        `INSERT INTO public.meter_events
           (organisation_id, meter_key, subject_id, quantity, idempotency_key, occurred_at, source, metadata)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8::jsonb)
         ON CONFLICT (organisation_id, meter_key, idempotency_key) DO NOTHING`,
        [
          input.organisationId,
          input.meterKey,
          input.subjectId ?? null,
          input.quantity,
          input.idempotencyKey,
          input.occurredAt ?? null,
          input.source ?? "platform",
          metadata,
        ]
      );
    });
    const inserted = (result.rowCount ?? 0) > 0;
    return { recorded: inserted, deduplicated: !inserted };
  }

  private async sum(
    client: { query: (t: string, v?: unknown[]) => Promise<{ rows: { total: string }[] }> },
    organisationId: string,
    meterKey: string,
    window: QuotaWindow
  ): Promise<number> {
    const r = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::text AS total
         FROM public.meter_events
        WHERE organisation_id = $1 AND meter_key = $2 AND ${WINDOW_SQL[window]}`,
      [organisationId, meterKey]
    );
    return Number(r.rows[0]?.total ?? "0");
  }

  async aggregate(organisationId: string, meterKey: string, window: QuotaWindow): Promise<number> {
    return withTenant(this.pool as never, organisationId, (client) =>
      this.sum(client as never, organisationId, meterKey, window)
    );
  }

  async aggregateAsOperator(
    organisationId: string,
    meterKey: string,
    window: QuotaWindow
  ): Promise<number> {
    return withSystemAdmin(this.pool as never, (client) =>
      this.sum(client as never, organisationId, meterKey, window)
    );
  }
}
