/**
 * PostgresProviderConfigRepository (ADR-0070 / ADR-ACT-0266).
 *
 * Backed by public.provider_configs (migration 032). Operator-global infra (no tenant
 * column); accessed via withSystemAdmin (mirrors worker_heartbeats). The table holds
 * NO plaintext secret — `credential_ref` is an opaque secret:<uuid> into the ADR-0069
 * secret store, guarded by a CHECK constraint; `config` holds non-secret keys only.
 */

import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  ProviderConfigRecord,
  ProviderConfigRepository,
  ProviderLifecycleState,
  UpsertProviderConfigInput,
} from "../ports/provider-config-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresProviderConfigProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

type DbTimestamp = Date | string | null;

interface Row {
  id: string;
  provider_key: string;
  capability: string;
  environment: "development" | "test" | "staging" | "production";
  instance_label: string;
  classification: string;
  lifecycle_state: ProviderLifecycleState;
  endpoint: string | null;
  credential_ref: string | null;
  config: Record<string, unknown> | string;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
  updated_by: string | null;
}

function iso(v: DbTimestamp): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function toRecord(r: Row): ProviderConfigRecord {
  return {
    id: r.id,
    providerKey: r.provider_key,
    capability: r.capability,
    environment: r.environment,
    instanceLabel: r.instance_label,
    classification: r.classification,
    lifecycleState: r.lifecycle_state,
    endpoint: r.endpoint,
    credentialRef: r.credential_ref,
    config: typeof r.config === "string" ? JSON.parse(r.config) : r.config,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

const COLUMNS =
  "id, provider_key, capability, environment, instance_label, classification, lifecycle_state, endpoint, credential_ref, config, created_at, updated_at, updated_by";

export function loadPostgresProviderConfigProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresProviderConfigProviderConfig {
  return {
    statementTimeoutMs: Number(env["PROVIDER_CONFIG_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["PROVIDER_CONFIG_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["PROVIDER_CONFIG_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresProviderConfigRepository implements ProviderConfigRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresProviderConfigProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresProviderConfigProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresProviderConfigProviderConfig(),
      ...config,
    };
  }

  async list(): Promise<ProviderConfigRecord[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.provider_configs ORDER BY capability, provider_key, environment, instance_label`
        );
        return r.rows.map(toRecord);
      })
    );
  }

  async listForCapability(capability: string): Promise<ProviderConfigRecord[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.provider_configs WHERE capability = $1 ORDER BY environment, provider_key, instance_label`,
          [capability]
        );
        return r.rows.map(toRecord);
      })
    );
  }

  async getByKey(
    providerKey: string,
    environment: string,
    instanceLabel: string
  ): Promise<ProviderConfigRecord | null> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.provider_configs WHERE provider_key = $1 AND environment = $2 AND instance_label = $3`,
          [providerKey, environment, instanceLabel]
        );
        return r.rows[0] ? toRecord(r.rows[0]) : null;
      })
    );
  }

  async upsert(input: UpsertProviderConfigInput): Promise<ProviderConfigRecord> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `INSERT INTO public.provider_configs
           (provider_key, capability, environment, instance_label, classification,
            lifecycle_state, endpoint, credential_ref, config, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT (provider_key, environment, instance_label) DO UPDATE SET
           capability = EXCLUDED.capability,
           classification = EXCLUDED.classification,
           lifecycle_state = EXCLUDED.lifecycle_state,
           endpoint = EXCLUDED.endpoint,
           credential_ref = EXCLUDED.credential_ref,
           config = EXCLUDED.config,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
         RETURNING ${COLUMNS}`,
          [
            input.providerKey,
            input.capability,
            input.environment,
            input.instanceLabel,
            input.classification,
            input.lifecycleState,
            input.endpoint,
            input.credentialRef,
            JSON.stringify(input.config ?? {}),
            input.updatedBy,
          ]
        );
        return toRecord(r.rows[0]!);
      })
    );
  }

  async setLifecycleState(id: string, lifecycleState: ProviderLifecycleState): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          "UPDATE public.provider_configs SET lifecycle_state = $2, updated_at = now() WHERE id = $1",
          [id, lifecycleState]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query("DELETE FROM public.provider_configs WHERE id = $1", [id]);
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async healthCheck(): Promise<{
    status: "ready";
    provider: "postgres-provider-config-repository";
  }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'provider_configs'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-provider-config-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 032-provider-configs.sql, inspect provider_configs secret-ref checks/grants and rls_bypass role membership, then retry provider config reconciliation or lifecycle transition";
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
      `postgres-provider-config-repository unavailable; no fallback is allowed for provider configuration or lifecycle state, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
