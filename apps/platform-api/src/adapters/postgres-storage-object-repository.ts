import type pg from "pg";
import type {
  CreateStorageObjectInput,
  StorageObjectRecord,
  StorageObjectRepository,
  StorageObjectScanState,
} from "../ports/storage-objects.ts";

const toIso = (d: Date | null) => (d ? d.toISOString() : null);
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
export class PostgresStorageObjectRepository implements StorageObjectRepository {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  async listForTenant(organisationId: string): Promise<StorageObjectRecord[]> {
    const { rows } = await this.pool.query<StorageRow>(
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
    const { rows } = await this.pool.query<StorageRow>(
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
    const { rows } = await this.pool.query<StorageRow>(
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
    const { rows } = await this.pool.query(
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
    await this.pool.query(
      `DELETE FROM public.storage_objects WHERE organisation_id=$1 AND object_key=$2`,
      [organisationId, objectKey]
    );
  }
}
