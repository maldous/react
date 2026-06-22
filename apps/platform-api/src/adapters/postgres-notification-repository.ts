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
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresNotificationProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

function toPref(row: { channel: string; category: string; enabled: boolean }): PreferenceRecord {
  return {
    channel: row.channel as NotificationChannel,
    category: row.category as NotificationCategory,
    enabled: row.enabled,
  };
}

export function loadPostgresNotificationProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresNotificationProviderConfig {
  return {
    statementTimeoutMs: Number(env["NOTIFICATION_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["NOTIFICATION_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["NOTIFICATION_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresNotificationRepository implements NotificationRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresNotificationProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresNotificationProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresNotificationProviderConfig(),
      ...config,
    };
  }

  async listPreferences(organisationId: string, userId: string): Promise<PreferenceRecord[]> {
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ channel: string; category: string; enabled: boolean }>(
          `SELECT channel, category, enabled FROM public.notification_preferences
          WHERE user_id = $1 ORDER BY channel, category`,
          [userId]
        );
        return r.rows.map(toPref);
      })
    );
  }

  async listPreferencesAsOperator(
    organisationId: string,
    userId: string
  ): Promise<PreferenceRecord[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ channel: string; category: string; enabled: boolean }>(
          `SELECT channel, category, enabled FROM public.notification_preferences
          WHERE organisation_id = $1 AND user_id = $2 ORDER BY channel, category`,
          [organisationId, userId]
        );
        return r.rows.map(toPref);
      })
    );
  }

  async upsertPreferences(input: UpsertPreferenceInput): Promise<void> {
    await this.withRetry(() =>
      withTenant(this.pool as never, input.organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
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
      })
    );
  }

  async logDispatch(input: LogDispatchInput): Promise<void> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
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
        );
      })
    );
  }

  async countLog(organisationId: string, userId: string): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM public.notification_log WHERE organisation_id=$1 AND user_id=$2",
          [organisationId, userId]
        );
        return Number(r.rows[0]?.n ?? "0");
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-notification-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('notification_preferences', 'notification_log')
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-notification-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 028-notifications.sql, inspect notification_preferences/notification_log RLS/grants, then retry notification preference or dispatch logging";
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
      `postgres-notification-repository unavailable; no fallback is allowed for notification preferences or dispatch logs, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
