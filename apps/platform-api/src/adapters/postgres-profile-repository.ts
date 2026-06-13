/**
 * PostgresProfileRepository (ADR-0068 / ADR-ACT-0260).
 *
 * Backed by public.user_profiles (migration 028), RLS-enabled. Tenant + user scoped;
 * the usecase always passes the session userId (own-profile-only). Reads/writes use
 * withTenant so RLS enforces tenant isolation.
 */

import { withTenant } from "@platform/adapters-postgres";
import type {
  ProfileRecord,
  ProfileRepository,
  UpsertProfileInput,
} from "../ports/profile-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

export class PostgresProfileRepository implements ProfileRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async getForUser(organisationId: string, userId: string): Promise<ProfileRecord | null> {
    return withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query(
        `SELECT display_name, locale, timezone FROM public.user_profiles WHERE user_id = $1`,
        [userId]
      );
      const row = r.rows[0] as
        | { display_name: string; locale: string; timezone: string }
        | undefined;
      return row
        ? { displayName: row.display_name, locale: row.locale, timezone: row.timezone }
        : null;
    });
  }

  async upsertForUser(input: UpsertProfileInput): Promise<ProfileRecord> {
    return withTenant(this.pool as never, input.organisationId, async (client) => {
      const r = await client.query(
        `INSERT INTO public.user_profiles (organisation_id, user_id, display_name, locale, timezone, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (organisation_id, user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           locale = EXCLUDED.locale,
           timezone = EXCLUDED.timezone,
           updated_at = now()
         RETURNING display_name, locale, timezone`,
        [input.organisationId, input.userId, input.displayName, input.locale, input.timezone]
      );
      const row = r.rows[0] as { display_name: string; locale: string; timezone: string };
      return { displayName: row.display_name, locale: row.locale, timezone: row.timezone };
    });
  }
}
