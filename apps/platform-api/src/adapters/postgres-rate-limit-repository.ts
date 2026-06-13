/**
 * PostgresRateLimitRepository (ADR-0065 / ADR-ACT-0257).
 *
 * Backed by public.rate_limit_policies + public.rate_limit_counters (migration 025),
 * RLS-enabled. Policy definitions are operator-managed; the counter is a durable
 * fixed-window bucket keyed by (org, policy, window_start). incrementAndCount upserts
 * the current window's row atomically and returns the running count. Tenant reads use
 * withTenant (RLS-scoped); writes + counter mutation + operator reads use withSystemAdmin.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  RateLimitPolicyRecord,
  RateLimitRepository,
  UpsertRateLimitInput,
} from "../ports/rate-limit-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

interface PolicyRow {
  policy_key: string;
  entitlement_key: string;
  limit_value: string | number;
  window_seconds: number;
  action: "allow" | "deny";
  updated_at: Date | string | null;
  updated_by: string | null;
}

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: PolicyRow): RateLimitPolicyRecord {
  return {
    policyKey: r.policy_key,
    entitlementKey: r.entitlement_key,
    limit: Number(r.limit_value),
    windowSeconds: r.window_seconds,
    action: r.action,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

const COLUMNS =
  "policy_key, entitlement_key, limit_value, window_seconds, action, updated_at, updated_by";

export class PostgresRateLimitRepository implements RateLimitRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async getByKey(organisationId: string, policyKey: string): Promise<RateLimitPolicyRecord | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT ${COLUMNS} FROM public.rate_limit_policies WHERE organisation_id = $1 AND policy_key = $2`,
        [organisationId, policyKey]
      );
      const row = r.rows[0] as PolicyRow | undefined;
      return row ? toRecord(row) : null;
    });
  }

  async listForTenant(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query(
        `SELECT ${COLUMNS} FROM public.rate_limit_policies ORDER BY policy_key`
      );
      return (r.rows as PolicyRow[]).map(toRecord);
    });
  }

  async listForTenantAsOperator(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT ${COLUMNS} FROM public.rate_limit_policies WHERE organisation_id = $1 ORDER BY policy_key`,
        [organisationId]
      );
      return (r.rows as PolicyRow[]).map(toRecord);
    });
  }

  async upsert(input: UpsertRateLimitInput): Promise<void> {
    await withSystemAdmin(this.pool as never, async (client) => {
      await client.query(
        `INSERT INTO public.rate_limit_policies
           (organisation_id, policy_key, entitlement_key, limit_value, window_seconds, action, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (organisation_id, policy_key) DO UPDATE SET
           entitlement_key = EXCLUDED.entitlement_key,
           limit_value     = EXCLUDED.limit_value,
           window_seconds  = EXCLUDED.window_seconds,
           action          = EXCLUDED.action,
           updated_by      = EXCLUDED.updated_by,
           updated_at      = now()`,
        [
          input.organisationId,
          input.policyKey,
          input.entitlementKey,
          input.limit,
          input.windowSeconds,
          input.action,
          input.updatedBy,
        ]
      );
    });
  }

  // Fixed-window bucket: floor(now / window) * window. Computed in SQL so the bucket
  // boundary is server-clock authoritative and not subject to app-clock skew.
  private windowStartSql(windowSeconds: number): string {
    return `to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds})`;
  }

  async incrementAndCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `INSERT INTO public.rate_limit_counters (organisation_id, policy_key, window_start, count)
         VALUES ($1, $2, ${this.windowStartSql(windowSeconds)}, 1)
         ON CONFLICT (organisation_id, policy_key, window_start)
           DO UPDATE SET count = public.rate_limit_counters.count + 1
         RETURNING count`,
        [organisationId, policyKey]
      );
      return Number((r.rows[0] as { count: string | number }).count);
    });
  }

  async currentCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT COALESCE(count, 0)::text AS count FROM public.rate_limit_counters
          WHERE organisation_id = $1 AND policy_key = $2
            AND window_start = ${this.windowStartSql(windowSeconds)}`,
        [organisationId, policyKey]
      );
      return Number((r.rows[0] as { count: string } | undefined)?.count ?? "0");
    });
  }
}
