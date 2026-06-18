// ---------------------------------------------------------------------------
// Search usecase (ADR-0060 / ADR-ACT-0258)
//
// Tenant-isolated, permission-aware product search over the built-in Postgres FTS
// substrate. Indexing is server-internal (producers push documents); the tenant
// query route is read-only and BFF-only. No secret fields are ever indexed — the
// index step rejects documents carrying secret-looking metadata keys. Reindex is an
// operator action and is audited. Search runs server-side; React renders results.
// ---------------------------------------------------------------------------

import { ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { SearchReadinessResponse, SearchResponse } from "@platform/contracts-admin";
import type {
  SearchDocumentInput,
  SearchIndexPort,
  SearchQueryPort,
} from "../ports/search-repository.ts";

export interface SearchDeps {
  index: SearchIndexPort;
  query: SearchQueryPort;
  audit: AuditEventPort;
}

export interface SearchActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

// Metadata keys that must never be indexed (secret-bearing). The index step rejects a
// document carrying any of these rather than silently leaking them into the index.
const SECRET_KEY_RE = /secret|password|token|credential|api[_-]?key|private[_-]?key/i;

function assertNoSecretFields(input: SearchDocumentInput): void {
  const offending = Object.keys(input.metadata ?? {}).filter((k) => SECRET_KEY_RE.test(k));
  if (offending.length > 0) {
    throw new ValidationError("api.error.secretFieldNotIndexable", {
      safeDetails: { fields: offending },
    });
  }
}

/** Server-internal: index (upsert) a document. Rejects secret-bearing metadata. */
export async function indexDocument(input: SearchDocumentInput, deps: SearchDeps): Promise<void> {
  if (input.title.trim().length === 0) {
    throw new ValidationError("api.error.searchTitleRequired", {});
  }
  assertNoSecretFields(input);
  await deps.index.index(input);
}

/** Server-internal: remove a document (e.g. on source delete). */
export async function removeDocument(
  organisationId: string,
  documentType: string,
  documentId: string,
  deps: SearchDeps
): Promise<boolean> {
  return deps.index.remove(organisationId, documentType, documentId);
}

/** Tenant query. `q` is plain text; the adapter parses it via plainto_tsquery (never
 * raw tsquery). Permission-aware: rows with a permission_key only appear when the
 * caller holds it. No secret fields are returned. */
export async function searchProducts(
  organisationId: string,
  input: {
    q: string;
    documentType?: string;
    page?: number;
    limit?: number;
  },
  permissions: string[],
  deps: SearchDeps
): Promise<SearchResponse> {
  const q = input.q.trim();
  if (q.length === 0) {
    throw new ValidationError("api.error.searchQueryRequired", {});
  }
  const started = Date.now();
  const result = await deps.query.search(organisationId, {
    q,
    documentType: input.documentType,
    permissions,
    page: input.page,
    limit: input.limit,
  });
  return {
    hits: result.hits.map((h) => ({
      documentId: h.documentId,
      documentType: h.documentType,
      title: h.title,
      url: h.url,
      score: h.score,
    })),
    total: result.total,
    tookMs: Date.now() - started,
  };
}

export type ReindexResult = { kind: "ok"; reindexed: number };

/** Operator-only, audited reindex (rebuild the tsvector for a tenant). */
export async function reindexTenant(
  input: { organisationId: string; actor: SearchActor },
  deps: SearchDeps
): Promise<ReindexResult> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.SearchReindexed,
      resource: "search",
      resourceId: input.organisationId,
      sourceHost: input.actor.sourceHost,
    })
  );
  const reindexed = await deps.index.reindex(input.organisationId);
  return { kind: "ok", reindexed };
}

/** Operator readiness. Never faked: `blocked` if the store is unreachable. */
export async function getSearchReadiness(deps: SearchDeps): Promise<SearchReadinessResponse> {
  try {
    const documentCount = await deps.index.countAll();
    return {
      engine: "postgres-fts",
      status: documentCount > 0 ? "ready" : "degraded",
      documentCount,
      detail:
        documentCount > 0
          ? "Postgres full-text search is reachable and has indexed documents."
          : "Postgres full-text search is reachable but no documents are indexed yet.",
    };
  } catch (err) {
    return {
      engine: "postgres-fts",
      status: "blocked",
      documentCount: 0,
      detail: `Search store unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
