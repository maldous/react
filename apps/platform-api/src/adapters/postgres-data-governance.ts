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
  DsrFulfillmentEvidence,
} from "../ports/data-governance.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgClient = { query<T = any>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };

export interface PostgresDataGovernanceProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
type DatasetRow = {
  dataset_id: string;
  owner: string;
  classification: DatasetClassification;
  lineage_edges: string[] | null;
  created_at: Date | null;
};
type ClassificationRow = {
  classification_id: string;
  dataset_id: string;
  column_name: string;
  classification: DatasetClassification;
  rule: string;
  created_at: Date | null;
};
type DsrRow = {
  dsr_id: string;
  organisation_id: string;
  subject_id?: string;
  type: DsrType;
  state: DsrState;
  reason: string;
  created_at: Date | null;
  fulfilled_at?: Date | null;
  fulfillment_evidence?: DsrFulfillmentEvidence | null;
};

export function loadPostgresDataGovernanceProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresDataGovernanceProviderConfig {
  return {
    statementTimeoutMs: Number(env["DATA_GOVERNANCE_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["DATA_GOVERNANCE_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["DATA_GOVERNANCE_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresDataGovernanceAdapter implements DataGovernancePort {
  private readonly pool: pg.Pool;
  private readonly providerConfig: PostgresDataGovernanceProviderConfig;

  constructor(pool: pg.Pool, config: Partial<PostgresDataGovernanceProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresDataGovernanceProviderConfig(),
      ...config,
    };
  }

  async listDatasets(): Promise<DatasetEntry[]> {
    const { rows } = await this.query<DatasetRow>(
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
    const { rows } = await this.query<DatasetRow>(
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
    let classification: DatasetClassification = "none";
    if (/(?:email|phone|ssn|card)/i.test(input.sampleValue)) {
      classification = "sensitive";
    } else if (/@/.test(input.sampleValue)) {
      classification = "pii";
    }
    const { rows } = await this.query<ClassificationRow>(
      `INSERT INTO public.data_classifications (dataset_id, column_name, classification, rule, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING classification_id, dataset_id, column_name, classification, rule, created_at`,
      [
        input.datasetId,
        input.columnName,
        input.classification ?? classification,
        input.rule ?? "rules-based",
        input.actorId,
      ]
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
    const { rows } = await this.query<ClassificationRow>(
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
    const { rows } = await this.query<DsrRow>(
      organisationId
        ? `SELECT dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at, fulfillment_evidence FROM public.dsr_requests WHERE organisation_id = $1 ORDER BY created_at DESC`
        : `SELECT dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at, fulfillment_evidence FROM public.dsr_requests ORDER BY created_at DESC`,
      organisationId ? [organisationId] : []
    );
    return rows.map((r) => ({
      dsrId: r.dsr_id,
      organisationId: r.organisation_id,
      subjectId: r.subject_id ?? "",
      type: r.type,
      state: r.state,
      reason: r.reason,
      createdAt: iso(r.created_at),
      fulfilledAt: iso(r.fulfilled_at ?? null),
      fulfillmentEvidence: r.fulfillment_evidence ?? null,
    }));
  }
  async createDsr(input: CreateDsrInput): Promise<DsrRecord> {
    const { rows } = await this.query<DsrRow>(
      `INSERT INTO public.dsr_requests (organisation_id, subject_id, type, state, reason, created_by) VALUES ($1,$2,$3,'open',$4,$5) RETURNING dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at, fulfillment_evidence`,
      [input.organisationId, input.subjectId, input.type, input.reason, input.actorId]
    );
    const r = rows[0]!;
    return {
      dsrId: r.dsr_id,
      organisationId: r.organisation_id,
      subjectId: r.subject_id ?? "",
      type: r.type,
      state: r.state,
      reason: r.reason,
      createdAt: iso(r.created_at),
      fulfilledAt: iso(r.fulfilled_at ?? null),
      fulfillmentEvidence: r.fulfillment_evidence ?? null,
    };
  }
  async fulfillDsr(input: {
    dsrId: string;
    actorId: string;
    evidence: DsrFulfillmentEvidence;
  }): Promise<DsrRecord> {
    const { rows } = await this.query<DsrRow>(
      `UPDATE public.dsr_requests SET state='fulfilled', fulfilled_at=now(), fulfilled_by=$2, fulfillment_evidence=$3 WHERE dsr_id=$1 AND state='open' RETURNING dsr_id, organisation_id, subject_id, type, state, reason, created_at, fulfilled_at, fulfillment_evidence`,
      [input.dsrId, input.actorId, JSON.stringify(input.evidence)]
    );
    const r = rows[0]!;
    if (!r) throw new Error(`DSR ${input.dsrId} not found or already fulfilled`);
    return {
      dsrId: r.dsr_id,
      organisationId: r.organisation_id,
      subjectId: r.subject_id ?? "",
      type: r.type,
      state: r.state,
      reason: r.reason,
      createdAt: iso(r.created_at),
      fulfilledAt: iso(r.fulfilled_at ?? null),
      fulfillmentEvidence: r.fulfillment_evidence ?? null,
    };
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-data-governance" }> {
    await this.query(
      `SELECT 1
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('data_catalog', 'data_classifications', 'dsr_requests')
        LIMIT 1`
    );
    return { status: "ready", provider: "postgres-data-governance" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migrations 041-data-governance.sql and 045-data-governance-fulfillment-evidence.sql, inspect data governance table grants, then retry DSR/catalog processing";
  }

  private async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.withRetry(async () => {
      const client = (await this.pool.connect()) as PgClient & { release(): void };
      try {
        await client.query("BEGIN");
        await this.applyQueryTimeout(client);
        const result = await client.query<T>(sql, values);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    });
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
      `postgres-data-governance unavailable; no fallback is allowed for catalog, classification, or DSR state changes, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${this.providerConfig.statementTimeoutMs}ms`,
    ]);
  }
}
