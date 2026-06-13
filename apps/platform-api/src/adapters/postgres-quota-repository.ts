/**
 * PostgresQuotaRepository (ADR-0067 / ADR-ACT-0256).
 *
 * Backed by public.tenant_quotas (migration 024), RLS-enabled. Tenant self-reads
 * (listForTenant / getByKey for enforcement) use withTenant (RLS-scoped); operator
 * reads/writes use withSystemAdmin (rls_bypass). `window` is stored as window_kind
 * (a reserved SQL keyword) and mapped to `window` here. No secret fields.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { QuotaAction, QuotaWindow } from "@platform/contracts-admin";
import type { QuotaRecord, QuotaRepository, UpsertQuotaInput } from "../ports/quota-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

interface Row {
  organisation_id: string;
  quota_key: string;
  entitlement_key: string;
  meter_key: string;
  limit_value: string;
  window_kind: QuotaWindow;
  action: QuotaAction;
  updated_at: string | null;
  updated_by: string | null;
}

function toRecord(row: Row): QuotaRecord {
  return {
    organisationId: row.organisation_id,
    quotaKey: row.quota_key,
    entitlementKey: row.entitlement_key,
    meterKey: row.meter_key,
    limit: Number(row.limit_value),
    window: row.window_kind,
    action: row.action,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

const COLS = `organisation_id, quota_key, entitlement_key, meter_key, limit_value, window_kind, action, updated_at, updated_by`;

export class PostgresQuotaRepository implements QuotaRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listForTenant(organisationId: string): Promise<QuotaRecord[]> {
    const rows = await withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLS} FROM public.tenant_quotas WHERE organisation_id = $1 ORDER BY quota_key`,
        [organisationId]
      );
      return r.rows;
    });
    return rows.map(toRecord);
  }

  async listForTenantAsOperator(organisationId: string): Promise<QuotaRecord[]> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLS} FROM public.tenant_quotas WHERE organisation_id = $1 ORDER BY quota_key`,
        [organisationId]
      );
      return r.rows;
    });
    return rows.map(toRecord);
  }

  async getByKey(organisationId: string, quotaKey: string): Promise<QuotaRecord | null> {
    const rows = await withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLS} FROM public.tenant_quotas WHERE organisation_id = $1 AND quota_key = $2`,
        [organisationId, quotaKey]
      );
      return r.rows;
    });
    return rows.length ? toRecord(rows[0]!) : null;
  }

  async upsert(input: UpsertQuotaInput): Promise<QuotaRecord> {
    const rows = await withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `INSERT INTO public.tenant_quotas
           (organisation_id, quota_key, entitlement_key, meter_key, limit_value, window_kind, action, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (organisation_id, quota_key) DO UPDATE SET
           entitlement_key = EXCLUDED.entitlement_key,
           meter_key       = EXCLUDED.meter_key,
           limit_value     = EXCLUDED.limit_value,
           window_kind     = EXCLUDED.window_kind,
           action          = EXCLUDED.action,
           updated_at      = now(),
           updated_by      = EXCLUDED.updated_by
         RETURNING ${COLS}`,
        [
          input.organisationId,
          input.quotaKey,
          input.entitlementKey,
          input.meterKey,
          input.limit,
          input.window,
          input.action,
          input.updatedBy,
        ]
      );
      return r.rows;
    });
    return toRecord(rows[0]!);
  }
}
