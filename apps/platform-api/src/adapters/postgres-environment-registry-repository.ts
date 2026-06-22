/**
 * PostgresEnvironmentRegistryRepository (ADR-0072 / ADR-ACT-0274).
 *
 * Backed by public.environment_registry (migration 033). Operator-global infra (no
 * tenant column); accessed via withSystemAdmin (mirrors provider_configs). The table
 * holds NO plaintext secret — secrets live in the secret store (ADR-0069), provider
 * bindings in provider_configs. CHECK constraints enforce "no mocks / no destructive
 * in staging|production" at the storage layer as a second line of defence.
 */

import { withSystemAdmin } from "@platform/adapters-postgres";
import type {
  BootstrapStatus,
  EnvironmentRecord,
  EnvironmentRegistryRepository,
  ProviderConfigStatus,
  UpsertEnvironmentInput,
} from "../ports/environment-registry-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresEnvironmentRegistryProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

type DbTimestamp = Date | string | null;

interface Row {
  environment_id: string;
  name: string;
  stage: EnvironmentRecord["stage"];
  executor: EnvironmentRecord["executor"];
  compose_project: string;
  base_url: string | null;
  api_url: string | null;
  domain: string | null;
  allowed_profiles: string[] | string;
  mock_policy: EnvironmentRecord["mockPolicy"];
  destructive_allowed: boolean;
  data_preservation: EnvironmentRecord["dataPreservation"];
  secret_store_provider: string;
  provider_config_status: ProviderConfigStatus;
  bootstrap_status: BootstrapStatus;
  metadata: Record<string, unknown> | string;
  last_bootstrapped_at: DbTimestamp;
  last_reconciled_at: DbTimestamp;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
}

function iso(v: DbTimestamp): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function asJson<T>(v: T | string): T {
  return typeof v === "string" ? (JSON.parse(v) as T) : v;
}

function toRecord(r: Row): EnvironmentRecord {
  const metadata = asJson<Record<string, unknown>>(r.metadata);
  const allowedMocks = Array.isArray(metadata["allowedMocks"])
    ? (metadata["allowedMocks"] as string[])
    : [];
  return {
    environmentId: r.environment_id,
    name: r.name,
    stage: r.stage,
    executor: r.executor,
    composeProject: r.compose_project,
    baseUrl: r.base_url,
    apiUrl: r.api_url,
    domain: r.domain,
    allowedProfiles: asJson<string[]>(r.allowed_profiles),
    allowedMocks,
    mockPolicy: r.mock_policy,
    destructiveAllowed: r.destructive_allowed,
    dataPreservation: r.data_preservation,
    secretStoreProvider: r.secret_store_provider,
    providerConfigStatus: r.provider_config_status,
    bootstrapStatus: r.bootstrap_status,
    metadata,
    lastBootstrappedAt: iso(r.last_bootstrapped_at),
    lastReconciledAt: iso(r.last_reconciled_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const COLUMNS =
  "environment_id, name, stage, executor, compose_project, base_url, api_url, domain, allowed_profiles, mock_policy, destructive_allowed, data_preservation, secret_store_provider, provider_config_status, bootstrap_status, metadata, last_bootstrapped_at, last_reconciled_at, created_at, updated_at";

export function loadPostgresEnvironmentRegistryProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresEnvironmentRegistryProviderConfig {
  return {
    statementTimeoutMs: Number(env["ENVIRONMENT_REGISTRY_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["ENVIRONMENT_REGISTRY_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["ENVIRONMENT_REGISTRY_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresEnvironmentRegistryRepository implements EnvironmentRegistryRepository {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresEnvironmentRegistryProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresEnvironmentRegistryProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresEnvironmentRegistryProviderConfig(),
      ...config,
    };
  }

  async list(): Promise<EnvironmentRecord[]> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.environment_registry
         ORDER BY CASE stage WHEN 'development' THEN 0 WHEN 'test' THEN 1 WHEN 'staging' THEN 2 ELSE 3 END`
        );
        return r.rows.map(toRecord);
      })
    );
  }

  async get(environmentId: string): Promise<EnvironmentRecord | null> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.environment_registry WHERE environment_id = $1`,
          [environmentId]
        );
        return r.rows[0] ? toRecord(r.rows[0]) : null;
      })
    );
  }

  async upsert(input: UpsertEnvironmentInput): Promise<EnvironmentRecord> {
    // allowedMocks rides in metadata so the typed column set stays non-secret + stable.
    const metadata = { ...(input.metadata ?? {}), allowedMocks: input.allowedMocks ?? [] };
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<Row>(
          `INSERT INTO public.environment_registry
           (environment_id, name, stage, executor, compose_project, base_url, api_url, domain,
            allowed_profiles, mock_policy, destructive_allowed, data_preservation,
            secret_store_provider, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb)
         ON CONFLICT (environment_id) DO UPDATE SET
           name = EXCLUDED.name,
           stage = EXCLUDED.stage,
           executor = EXCLUDED.executor,
           compose_project = EXCLUDED.compose_project,
           base_url = EXCLUDED.base_url,
           api_url = EXCLUDED.api_url,
           domain = EXCLUDED.domain,
           allowed_profiles = EXCLUDED.allowed_profiles,
           mock_policy = EXCLUDED.mock_policy,
           destructive_allowed = EXCLUDED.destructive_allowed,
           data_preservation = EXCLUDED.data_preservation,
           secret_store_provider = EXCLUDED.secret_store_provider,
           metadata = EXCLUDED.metadata,
           updated_at = now()
         RETURNING ${COLUMNS}`,
          [
            input.environmentId,
            input.name,
            input.stage,
            input.executor,
            input.composeProject,
            input.baseUrl,
            input.apiUrl,
            input.domain,
            JSON.stringify(input.allowedProfiles ?? []),
            input.mockPolicy,
            input.destructiveAllowed,
            input.dataPreservation,
            input.secretStoreProvider,
            JSON.stringify(metadata),
          ]
        );
        return toRecord(r.rows[0]!);
      })
    );
  }

  async setProviderConfigStatus(
    environmentId: string,
    status: ProviderConfigStatus
  ): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `UPDATE public.environment_registry
         SET provider_config_status = $2, updated_at = now() WHERE environment_id = $1`,
          [environmentId, status]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async setBootstrapStatus(environmentId: string, status: BootstrapStatus): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `UPDATE public.environment_registry
         SET bootstrap_status = $2,
             last_bootstrapped_at = CASE WHEN $2 = 'bootstrapped' THEN now() ELSE last_bootstrapped_at END,
             updated_at = now()
         WHERE environment_id = $1`,
          [environmentId, status]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async markReconciled(environmentId: string): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `UPDATE public.environment_registry
         SET last_reconciled_at = now(), updated_at = now() WHERE environment_id = $1`,
          [environmentId]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async delete(environmentId: string): Promise<boolean> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          "DELETE FROM public.environment_registry WHERE environment_id = $1",
          [environmentId]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async healthCheck(): Promise<{
    status: "ready";
    provider: "postgres-environment-registry-repository";
  }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'environment_registry'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-environment-registry-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 033-environment-registry.sql, inspect environment_registry constraints/grants and rls_bypass role membership, then retry environment registry sync or status transition";
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
      `postgres-environment-registry-repository unavailable; no fallback is allowed for environment safety and bootstrap state, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
