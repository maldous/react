// ---------------------------------------------------------------------------
// Search ports (ADR-0060 / ADR-ACT-0258).
//
// Two bounded ports: SearchIndexPort (write/lifecycle) and SearchQueryPort (read),
// both satisfied today by the built-in Postgres FTS adapter. Meilisearch/Typesense/
// OpenSearch are Phase-4.5 providers behind these same ports. Tenant-scoped (RLS);
// query is permission-aware. No secret fields are persisted (enforced in the usecase).
// ---------------------------------------------------------------------------

export interface SearchDocumentInput {
  organisationId: string;
  documentId: string;
  documentType: string;
  title: string;
  body: string;
  url?: string;
  /** NULL = visible to any tenant member; else the caller must hold this permission. */
  permissionKey?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchQueryInput {
  q: string;
  documentType?: string;
  /** Permissions held by the caller; rows whose permission_key is set are filtered to these. */
  permissions: string[];
  page?: number;
  limit?: number;
}

export interface SearchHitRow {
  documentId: string;
  documentType: string;
  title: string;
  url: string | null;
  score: number;
}

export interface SearchQueryResult {
  hits: SearchHitRow[];
  total: number;
}

/** Write side: upsert/delete documents + rebuild the tsvector. Server-internal. */
export interface SearchIndexPort {
  /** Tenant-scoped upsert (by org + type + documentId); maintains the tsvector. */
  index(input: SearchDocumentInput): Promise<void>;
  /** Remove a document by its producer id (tenant-scoped). Returns false if absent. */
  remove(organisationId: string, documentType: string, documentId: string): Promise<boolean>;
  /** Operator reindex: recompute the tsvector for a tenant's documents. Returns the count. */
  reindex(organisationId: string): Promise<number>;
  /** Operator: total indexed documents (for readiness). */
  countAll(): Promise<number>;
}

/** Read side: permission-aware, tenant-scoped full-text query (RLS-enforced). */
export interface SearchQueryPort {
  search(organisationId: string, input: SearchQueryInput): Promise<SearchQueryResult>;
}
