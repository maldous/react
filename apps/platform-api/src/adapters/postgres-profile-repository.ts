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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgClient = { query<T = any>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };

export interface PostgresProfileProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

export function loadPostgresProfileProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresProfileProviderConfig {
  return {
    statementTimeoutMs: Number(env["PROFILE_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["PROFILE_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["PROFILE_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresProfileRepository implements ProfileRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresProfileProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresProfileProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresProfileProviderConfig(),
      ...config,
    };
  }

  async getForUser(organisationId: string, userId: string): Promise<ProfileRecord | null> {
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
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
      })
    );
  }

  async upsertForUser(input: UpsertProfileInput): Promise<ProfileRecord> {
    return this.withRetry(() =>
      withTenant(this.pool as never, input.organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
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
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-profile-repository" }> {
    await this.withRetry(() =>
      withTenant(
        this.pool as never,
        "00000000-0000-4000-8000-000000000001",
        async (client: PgClient) => {
          await this.applyQueryTimeout(client);
          await client.query(
            `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'user_profiles'
            LIMIT 1`
          );
        }
      )
    );
    return { status: "ready", provider: "postgres-profile-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 028-user-profiles.sql, inspect user_profiles RLS and grants, then retry the tenant-scoped profile operation";
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
      `postgres-profile-repository unavailable; no fallback is allowed for tenant profile persistence, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
