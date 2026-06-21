import type pg from "pg";
import type {
  ClassifyColumnInput,
  CreateDatasetEntryInput,
  CreateDsrInput,
  DataClassificationRecord,
  DataGovernancePort,
  DatasetEntry,
  DsrRecord,
  DatasetClassification,
  DsrType,
  DsrState,
} from "../ports/data-governance.ts";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
type Row = {
  dataset_id: string;
  owner: string;
  classification: DatasetClassification;
  lineage_edges: string[] | null;
  created_at: Date | null;
  classification_id?: string;
  column_name?: string;
  rule?: string;
  subject_id?: string;
  type?: DsrType;
  state?: DsrState;
  reason?: string;
  fulfilled_at?: Date | null;
};

export class PostgresDataGovernanceAdapter implements DataGovernancePort {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  async listDatasets(): Promise<DatasetEntry[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT dataset_id, owner, classification, lineage_edges, created_at FROM public.data_catalog ORDER BY created_at DESC`
    );
    return rows.map((r) => ({
      datasetId: r.dataset_id,
      owner: r.owner,
      classification: r.classification,
      lineageEdges: r.lineage_edges ?? [],
      createdAt: iso(r.created_at),
    }));
  }
  async createDataset(input: CreateDatasetEntryInput): Promise<DatasetEntry> {
    const { rows } = await this.pool.query(
      `INSERT INTO public.data_catalog (owner, classification, lineage_edges, created_by) VALUES ($1,$2,$3,$4) RETURNING dataset_id, owner, classification, lineage_edges, created_at`,
      [input.owner, input.classification, input.lineageEdges ?? [], input.actorId]
    );
    const r = rows[0]!;
    return {
      datasetId: r.dataset_id,
      owner: r.owner,
      classification: r.classification,
      lineageEdges: r.lineage_edges ?? [],
      createdAt: iso(r.created_at),
    };
  }
  async classifyColumn(input: ClassifyColumnInput): Promise<DataClassificationRecord> {
    const classification = /(?:email|phone|ssn|card)/i.test(input.sampleValue)
      ? "sensitive"
      : /@/.test(input.sampleValue)
        ? "pii"
        : "none";
    const { rows } = await this.pool.query(
      `INSERT INTO public.data_classifications (dataset_id, column_name, classification, rule, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING classification_id, dataset_id, column_name, classification, rule, created_at`,
      [input.datasetId, input.columnName, classification, "rules-based", input.actorId]
    );
    const r = rows[0]!;
    return {
      classificationId: r.classification_id,
      datasetId: r.dataset_id,
      columnName: r.column_name,
      classification: r.classification,
      rule: r.rule,
      createdAt: iso(r.created_at),
    };
  }
  async listClassifications(datasetId?: string): Promise<DataClassificationRecord[]> {
    const { rows } = await this.pool.query(
      datasetId
        ? `SELECT classification_id, dataset_id, column_name, classification, rule, created_at FROM public.data_classifications WHERE dataset_id = $1 ORDER BY created_at DESC`
        : `SELECT classification_id, dataset_id, column_name, classification, rule, created_at FROM public.data_classifications ORDER BY created_at DESC`,
      datasetId ? [datasetId] : []
    );
    return rows.map((r) => ({
      classificationId: r.classification_id,
      datasetId: r.dataset_id,
      columnName: r.column_name,
      classification: r.classification,
      rule: r.rule,
      createdAt: iso(r.created_at),
    }));
  }
  async listDsrs(organisationId: string): Promise<DsrRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at FROM public.dsr_requests WHERE organisation_id = $1 ORDER BY created_at DESC`,
      [organisationId]
    );
    return rows.map(
      (r: {
        dsr_id: string;
        organisation_id: string;
        subject_id: string;
        type: string;
        state: string;
        reason: string;
        created_at: Date | null;
        fulfilled_at: Date | null;
      }) => ({
        dsrId: r.dsr_id,
        organisationId: r.organisation_id,
        subjectId: r.subject_id,
        type: r.type as DsrType,
        state: r.state as DsrState,
        reason: r.reason,
        createdAt: iso(r.created_at),
        fulfilledAt: iso(r.fulfilled_at),
      })
    );
  }
  async createDsr(input: CreateDsrInput): Promise<DsrRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO public.dsr_requests (organisation_id, subject_id, type, state, reason, created_by) VALUES ($1,$2,$3,'open',$4,$5) RETURNING dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at`,
      [input.organisationId, input.subjectId, input.type, input.reason, input.actorId]
    );
    const r = rows[0]!;
    return {
      dsrId: r.dsr_id,
      organisationId: r.organisation_id,
      subjectId: r.subject_id,
      type: r.type as DsrType,
      state: r.state as DsrState,
      reason: r.reason,
      createdAt: iso(r.created_at),
      fulfilledAt: iso(r.fulfilled_at),
    };
  }
  async fulfillDsr(input: { dsrId: string; actorId: string }): Promise<DsrRecord> {
    const { rows } = await this.pool.query(
      `UPDATE public.dsr_requests SET state='fulfilled', fulfilled_at=now(), fulfilled_by=$2 WHERE dsr_id=$1 RETURNING dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at`,
      [input.dsrId, input.actorId]
    );
    const r = rows[0]!;
    return {
      dsrId: r.dsr_id,
      organisationId: r.organisation_id,
      subjectId: r.subject_id,
      type: r.type as DsrType,
      state: r.state as DsrState,
      reason: r.reason,
      createdAt: iso(r.created_at),
      fulfilledAt: iso(r.fulfilled_at),
    };
  }
}
