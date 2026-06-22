/**
 * PostgresSearchRepository (ADR-0060 / ADR-ACT-0258).
 *
 * Built-in full-text search over public.search_documents (migration 026), RLS-enabled.
 * Implements both SearchIndexPort and SearchQueryPort. The tsvector is maintained on
 * write (to_tsvector('english', title || ' ' || body)) and rebuilt by reindex. Queries
 * use plainto_tsquery (plain text from the client — never raw tsquery) + ts_rank, and a
 * permission filter (permission_key IS NULL OR permission_key = ANY(perms)). Tenant
 * reads/writes use withTenant (RLS enforces isolation); operator reindex/count use
 * withSystemAdmin (rls_bypass). No secret fields are stored (enforced upstream).
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import type {
  SearchDocumentInput,
  SearchIndexPort,
  SearchQueryInput,
  SearchQueryPort,
  SearchQueryResult,
} from "../ports/search-repository.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export interface PostgresSearchProviderConfig {
  statementTimeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  configSource: "POSTGRES_APP_URL";
  secretSource: "POSTGRES_APP_URL";
}

const TEXT_CONFIG = "english";

export function loadPostgresSearchProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresSearchProviderConfig {
  return {
    statementTimeoutMs: Number(env["SEARCH_QUERY_TIMEOUT_MS"] ?? "5000"),
    retryAttempts: Number(env["SEARCH_RETRY_ATTEMPTS"] ?? "1"),
    retryBackoffMs: Number(env["SEARCH_RETRY_BACKOFF_MS"] ?? "100"),
    configSource: "POSTGRES_APP_URL",
    secretSource: "POSTGRES_APP_URL",
  };
}

export class PostgresSearchRepository implements SearchIndexPort, SearchQueryPort {
  private readonly pool: PgPool;
  private readonly providerConfig: PostgresSearchProviderConfig;

  constructor(pool: PgPool, config: Partial<PostgresSearchProviderConfig> = {}) {
    this.pool = pool;
    this.providerConfig = {
      ...loadPostgresSearchProviderConfig(),
      ...config,
    };
  }

  async index(input: SearchDocumentInput): Promise<void> {
    const metadata = JSON.stringify(input.metadata ?? {});
    await this.withRetry(() =>
      withTenant(this.pool as never, input.organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `INSERT INTO public.search_documents
           (organisation_id, document_id, document_type, title, body, url, permission_key, metadata, search_vector, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
                 to_tsvector('${TEXT_CONFIG}', coalesce($4,'') || ' ' || coalesce($5,'')), now())
         ON CONFLICT (organisation_id, document_type, document_id) DO UPDATE SET
           title          = EXCLUDED.title,
           body           = EXCLUDED.body,
           url            = EXCLUDED.url,
           permission_key = EXCLUDED.permission_key,
           metadata       = EXCLUDED.metadata,
           search_vector  = EXCLUDED.search_vector,
           updated_at     = now()`,
          [
            input.organisationId,
            input.documentId,
            input.documentType,
            input.title,
            input.body,
            input.url ?? null,
            input.permissionKey ?? null,
            metadata,
          ]
        );
      })
    );
  }

  async remove(organisationId: string, documentType: string, documentId: string): Promise<boolean> {
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `DELETE FROM public.search_documents
          WHERE document_type = $1 AND document_id = $2`,
          [documentType, documentId]
        );
        return (r.rowCount ?? 0) > 0;
      })
    );
  }

  async reindex(organisationId: string): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query(
          `UPDATE public.search_documents
            SET search_vector = to_tsvector('${TEXT_CONFIG}', coalesce(title,'') || ' ' || coalesce(body,'')),
                updated_at = now()
          WHERE organisation_id = $1`,
          [organisationId]
        );
        return r.rowCount ?? 0;
      })
    );
  }

  async countAll(): Promise<number> {
    return this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        const r = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM public.search_documents"
        );
        return Number(r.rows[0]?.n ?? "0");
      })
    );
  }

  async search(organisationId: string, input: SearchQueryInput): Promise<SearchQueryResult> {
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
    const page = Math.max(input.page ?? 1, 1);
    const offset = (page - 1) * limit;
    return this.withRetry(() =>
      withTenant(this.pool as never, organisationId, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        // permission filter: NULL permission_key is public to tenant members; otherwise
        // the row only appears when the caller holds that permission. Type filter optional.
        // The WHERE params ($1 q, $2 permissions, optional $3 type) are shared by the
        // count + select; the select appends limit/offset as the trailing params.
        const whereParams: unknown[] = [input.q, input.permissions];
        let typeClause = "";
        if (input.documentType) {
          whereParams.push(input.documentType);
          typeClause = ` AND document_type = $${whereParams.length}`;
        }
        const where = `search_vector @@ plainto_tsquery('${TEXT_CONFIG}', $1)
          AND (permission_key IS NULL OR permission_key = ANY($2::text[]))${typeClause}`;
        const limitIdx = whereParams.length + 1;
        const offsetIdx = whereParams.length + 2;
        const rows = await client.query<{
          document_id: string;
          document_type: string;
          title: string;
          url: string | null;
          score: number;
        }>(
          `SELECT document_id, document_type, title, url,
                ts_rank(search_vector, plainto_tsquery('${TEXT_CONFIG}', $1)) AS score
           FROM public.search_documents
          WHERE ${where}
          ORDER BY score DESC, updated_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...whereParams, limit, offset]
        );
        const totalRes = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM public.search_documents WHERE ${where}`,
          whereParams
        );
        return {
          hits: rows.rows.map((r) => ({
            documentId: r.document_id,
            documentType: r.document_type,
            title: r.title,
            url: r.url,
            score: Number(r.score),
          })),
          total: Number(totalRes.rows[0]?.n ?? "0"),
        };
      })
    );
  }

  async healthCheck(): Promise<{ status: "ready"; provider: "postgres-search-repository" }> {
    await this.withRetry(() =>
      withSystemAdmin(this.pool as never, async (client: PgClient) => {
        await this.applyQueryTimeout(client);
        await client.query(
          `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'search_documents'
            LIMIT 1`
        );
      })
    );
    return { status: "ready", provider: "postgres-search-repository" };
  }

  recoveryAction(): string {
    return "operator recovery: verify POSTGRES_APP_URL secret/config, run migration 026-search.sql, inspect search_documents RLS/grants and tsvector indexes, then retry search indexing, query, or reindex";
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
      `postgres-search-repository unavailable; no fallback is allowed for search indexing or query, fail-closed after retry attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async applyQueryTimeout(client: PgClient): Promise<void> {
    await client.query(`SET LOCAL statement_timeout = ${this.providerConfig.statementTimeoutMs}`);
  }
}
