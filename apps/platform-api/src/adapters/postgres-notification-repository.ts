/**
 * PostgresNotificationRepository (ADR-0068 / ADR-ACT-0260).
 *
 * Backed by public.notification_preferences + public.notification_log (migration 028),
 * RLS-enabled. Tenant + user scoped. Self reads/writes use withTenant; operator reads
 * (test-notification for a target user) + log counts use withSystemAdmin. No secret
 * payload fields are logged (enforced in the usecase).
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type { NotificationCategory, NotificationChannel } from "@platform/contracts-admin";
import type {
  LogDispatchInput,
  NotificationRepository,
  PreferenceRecord,
  UpsertPreferenceInput,
} from "../ports/notification-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };

function toPref(row: { channel: string; category: string; enabled: boolean }): PreferenceRecord {
  return {
    channel: row.channel as NotificationChannel,
    category: row.category as NotificationCategory,
    enabled: row.enabled,
  };
}

export class PostgresNotificationRepository implements NotificationRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listPreferences(organisationId: string, userId: string): Promise<PreferenceRecord[]> {
    return withTenant(this.pool as never, organisationId, async (client) => {
      const r = await client.query(
        `SELECT channel, category, enabled FROM public.notification_preferences
          WHERE user_id = $1 ORDER BY channel, category`,
        [userId]
      );
      return (r.rows as { channel: string; category: string; enabled: boolean }[]).map(toPref);
    });
  }

  async listPreferencesAsOperator(
    organisationId: string,
    userId: string
  ): Promise<PreferenceRecord[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `SELECT channel, category, enabled FROM public.notification_preferences
          WHERE organisation_id = $1 AND user_id = $2 ORDER BY channel, category`,
        [organisationId, userId]
      );
      return (r.rows as { channel: string; category: string; enabled: boolean }[]).map(toPref);
    });
  }

  async upsertPreferences(input: UpsertPreferenceInput): Promise<void> {
    await withTenant(this.pool as never, input.organisationId, async (client) => {
      for (const p of input.preferences) {
        await client.query(
          `INSERT INTO public.notification_preferences
             (organisation_id, user_id, channel, category, enabled, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (organisation_id, user_id, channel, category) DO UPDATE SET
             enabled = EXCLUDED.enabled, updated_at = now()`,
          [input.organisationId, input.userId, p.channel, p.category, p.enabled]
        );
      }
    });
  }

  async logDispatch(input: LogDispatchInput): Promise<void> {
    await withSystemAdmin(this.pool as never, (client) =>
      client.query(
        `INSERT INTO public.notification_log
           (organisation_id, user_id, channel, category, status, subject)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.organisationId,
          input.userId,
          input.channel,
          input.category,
          input.status,
          input.subject ?? null,
        ]
      )
    );
  }

  async countLog(organisationId: string, userId: string): Promise<number> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.notification_log WHERE organisation_id=$1 AND user_id=$2",
        [organisationId, userId]
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }
}
