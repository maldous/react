export type StorageObjectScanState = "uploaded" | "quarantined" | "scanning" | "clean" | "rejected";

export interface StorageObjectRecord {
  objectId: string;
  organisationId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  scanState: StorageObjectScanState;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateStorageObjectInput {
  organisationId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  createdBy: string;
}

export interface StorageObjectRepository {
  listForTenant(organisationId: string): Promise<StorageObjectRecord[]>;
  get(organisationId: string, objectKey: string): Promise<StorageObjectRecord | null>;
  create(input: CreateStorageObjectInput): Promise<StorageObjectRecord>;
  setScanState(
    organisationId: string,
    objectKey: string,
    state: StorageObjectScanState
  ): Promise<StorageObjectRecord>;
  delete(organisationId: string, objectKey: string): Promise<void>;
}
