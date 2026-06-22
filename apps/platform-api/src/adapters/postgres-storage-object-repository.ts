import type pg from "pg";
import type {
  CreateStorageObjectInput,
  StorageObjectRecord,
  StorageObjectRepository,
  StorageObjectScanState,
} from "../ports/storage-objects.ts";

const toIso = (d: Date | null) => (d ? d.toISOString() : null);
export interface PostgresStorageObjectProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

type StorageRow = {
  object_id: string;
  organisation_id: string;
  object_key: string;
  content_type: string;
  size_bytes: number | string;
  scan_state: StorageObjectScanState;
  created_at: Date | null;
  updated_at: Date | null;
};

export function loadPostgresStorageObjectProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresStorageObjectProviderConfig {
  return {
    statementTimeoutMs: Number(env["STORAGE_OBJECT_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["STORAGE_OBJECT_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["STORAGE_OBJECT_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresStorageObjectRepository implements StorageObjectRepository {
  private readonly pool: pg.Pool;
  private readonly providerConfig: PostgresStorageObjectProviderConfig;

  constructor(pool: pg.Pool, config: Partial<PostgresStorageObjectProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresStorageObjectProviderConfig(),
      ...config,
    };
  }

  async listForTenant(organisationId: string): Promise<StorageObjectRecord[]> {
    const { rows } = await this.query<StorageRow>(
      `SELECT object_id, organisation_id, object_key, content_type, size_bytes, scan_state, created_at, updated_at FROM public.storage_objects WHERE organisation_id=$1 ORDER BY created_at DESC`,
      [organisationId]
    );
    return rows.map((r) => ({
      objectId: r.object_id,
      organisationId: r.organisation_id,
      objectKey: r.object_key,
      contentType: r.content_type,
      sizeBytes: Number(r.size_bytes),
      scanState: r.scan_state,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  }

  async get(organisationId: string, objectKey: string): Promise<StorageObjectRecord | null> {
    const { rows } = await this.query<StorageRow>(
      `SELECT object_id, organisation_id, object_key, content_type, size_bytes, scan_state, created_at, updated_at FROM public.storage_objects WHERE organisation_id=$1 AND object_key=$2`,
      [organisationId, objectKey]
    );
    return rows[0]
      ? {
          objectId: rows[0].object_id,
          organisationId: rows[0].organisation_id,
          objectKey: rows[0].object_key,
          contentType: rows[0].content_type,
          sizeBytes: Number(rows[0].size_bytes),
          scanState: rows[0].scan_state,
          createdAt: toIso(rows[0].created_at),
          updatedAt: toIso(rows[0].updated_at),
        }
      : null;
  }

  async create(input: CreateStorageObjectInput): Promise<StorageObjectRecord> {
    const { rows } = await this.query<StorageRow>(
      `INSERT INTO public.storage_objects (organisation_id, object_key, content_type, size_bytes, scan_state, created_by) VALUES ($1,$2,$3,$4,'uploaded',$5) RETURNING object_id, organisation_id, object_key, content_type, size_bytes, scan_state, created_at, updated_at`,
      [input.organisationId, input.objectKey, input.contentType, input.sizeBytes, input.createdBy]
    );
    const r = rows[0]!;
    return {
      objectId: r.object_id,
      organisationId: r.organisation_id,
      objectKey: r.object_key,
      contentType: r.content_type,
      sizeBytes: Number(r.size_bytes),
      scanState: r.scan_state,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  async setScanState(
    organisationId: string,
    objectKey: string,
    state: StorageObjectScanState
  ): Promise<StorageObjectRecord> {
    const { rows } = await this.query<StorageRow>(
      `UPDATE public.storage_objects SET scan_state=$3, updated_at=now() WHERE organisation_id=$1 AND object_key=$2 RETURNING object_id, organisation_id, object_key, content_type, size_bytes, scan_state, created_at, updated_at`,
      [organisationId, objectKey, state]
    );
    const r = rows[0]!;
    return {
      objectId: r.object_id,
      organisationId: r.organisation_id,
      objectKey: r.object_key,
      contentType: r.content_type,
      sizeBytes: Number(r.size_bytes),
      scanState: r.scan_state,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  async delete(organisationId: string, objectKey: string): Promise<void> {
    await this.query(
      `DELETE FROM public.storage_objects WHERE organisation_id=$1 AND object_key=$2`,
      [organisationId, objectKey]
    );
  }

  async healthCheck(): Promise<{
    status: "ready";
    provider: "postgres-storage-object-repository";
  }> {
    await this.query(
      `SELECT 1
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'storage_objects'
        LIMIT 1`
    );
    return { status: "ready", provider: "postgres-storage-object-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run storage object migrations, inspect storage_objects tenant predicates and grants, then retry the object metadata operation";
  }

  private async query<T extends pg.QueryResultRow>(
    sql: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.providerConfig.retryAttempts; attempt += 1) {
      try {
        await this.pool.query(
          `SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`
        );
        return await this.pool.query<T>(sql, values);
      } catch (err) {
        lastError = err;
        if (attempt >= this.providerConfig.retryAttempts) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.providerConfig.retryBackoffMs * (attempt + 1))
        );
      }
    }
    throw new Error(
      `postgres-storage-object-repository unavailable; no fallback is allowed for tenant storage metadata, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}
