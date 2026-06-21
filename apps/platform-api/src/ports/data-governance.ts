export type DatasetClassification = "none" | "pii" | "sensitive";
export type DsrType = "access" | "erasure" | "portability";
export type DsrState = "open" | "fulfilled";

export interface DatasetEntry {
  datasetId: string;
  owner: string;
  classification: DatasetClassification;
  lineageEdges: string[];
  createdAt: string | null;
}

export interface DataClassificationRecord {
  classificationId: string;
  datasetId: string;
  columnName: string;
  classification: DatasetClassification;
  rule: string;
  createdAt: string | null;
}

export interface DsrRecord {
  dsrId: string;
  organisationId: string;
  subjectId: string;
  type: DsrType;
  state: DsrState;
  reason: string;
  createdAt: string | null;
  fulfilledAt: string | null;
}

export interface CreateDatasetEntryInput {
  owner: string;
  classification: DatasetClassification;
  lineageEdges?: string[];
  actorId: string;
}

export interface ClassifyColumnInput {
  datasetId: string;
  columnName: string;
  sampleValue: string;
  actorId: string;
}

export interface CreateDsrInput {
  organisationId: string;
  subjectId: string;
  type: DsrType;
  reason: string;
  actorId: string;
}

export interface DataGovernancePort {
  listDatasets(): Promise<DatasetEntry[]>;
  createDataset(input: CreateDatasetEntryInput): Promise<DatasetEntry>;
  classifyColumn(input: ClassifyColumnInput): Promise<DataClassificationRecord>;
  listClassifications(datasetId?: string): Promise<DataClassificationRecord[]>;
  listDsrs(organisationId: string): Promise<DsrRecord[]>;
  createDsr(input: CreateDsrInput): Promise<DsrRecord>;
  fulfillDsr(input: { dsrId: string; actorId: string }): Promise<DsrRecord>;
}
