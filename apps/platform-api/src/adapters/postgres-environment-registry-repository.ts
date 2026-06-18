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

export class PostgresEnvironmentRegistryRepository implements EnvironmentRegistryRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async list(): Promise<EnvironmentRecord[]> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLUMNS} FROM public.environment_registry
         ORDER BY CASE stage WHEN 'development' THEN 0 WHEN 'test' THEN 1 WHEN 'staging' THEN 2 ELSE 3 END`
      );
      return r.rows.map(toRecord);
    });
  }

  async get(environmentId: string): Promise<EnvironmentRecord | null> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query<Row>(
        `SELECT ${COLUMNS} FROM public.environment_registry WHERE environment_id = $1`,
        [environmentId]
      );
      return r.rows[0] ? toRecord(r.rows[0]) : null;
    });
  }

  async upsert(input: UpsertEnvironmentInput): Promise<EnvironmentRecord> {
    // allowedMocks rides in metadata so the typed column set stays non-secret + stable.
    const metadata = { ...(input.metadata ?? {}), allowedMocks: input.allowedMocks ?? [] };
    return withSystemAdmin(this.pool as never, async (client) => {
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
    });
  }

  async setProviderConfigStatus(
    environmentId: string,
    status: ProviderConfigStatus
  ): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.environment_registry
         SET provider_config_status = $2, updated_at = now() WHERE environment_id = $1`,
        [environmentId, status]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async setBootstrapStatus(environmentId: string, status: BootstrapStatus): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.environment_registry
         SET bootstrap_status = $2,
             last_bootstrapped_at = CASE WHEN $2 = 'bootstrapped' THEN now() ELSE last_bootstrapped_at END,
             updated_at = now()
         WHERE environment_id = $1`,
        [environmentId, status]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async markReconciled(environmentId: string): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        `UPDATE public.environment_registry
         SET last_reconciled_at = now(), updated_at = now() WHERE environment_id = $1`,
        [environmentId]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async delete(environmentId: string): Promise<boolean> {
    return withSystemAdmin(this.pool as never, async (client) => {
      const r = await client.query(
        "DELETE FROM public.environment_registry WHERE environment_id = $1",
        [environmentId]
      );
      return (r.rowCount ?? 0) > 0;
    });
  }
}
