# Phase 4 — tenant-isolated product search (delivery evidence)

- **Action:** ADR-ACT-0258 — governing ADR: ADR-0060 (search & indexing, **Accepted** for the built-in Postgres FTS foundation; composed Meilisearch/Typesense/OpenSearch remain a **Proposed** Phase-4.5 provider sub-decision).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 4 is the built-in Postgres full-text foundation only; no search engine is composed.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS) — proofs run repos as the non-superuser `platform_app` role, create + clean up their own test orgs, and SKIP honestly (exit 0) if Postgres is unavailable:

- `proof:search` — index + query; **secret-bearing metadata rejected before indexing**; empty query rejected; removed document disappears; reindex rebuilds the tsvector + reports the count; readiness reports `postgres-fts` reachable; **no secret-bearing columns**; results carry no body/secret fields.
- `proof:search-isolation` — two tenants index a document with the **same title**; tenant A's query (under A's tenant context, **RLS-enforced**) returns only A's document and never B's; the **permission filter** hides a `permission_key`-gated row from a caller without the permission and reveals it to a holder.
- `proof:search-routes` — invokes the **real route handlers**: tenant search returns the indexed hit; missing tenant context rejected; empty query rejected; operator readiness returns a non-blocked status; operator reindex returns a count; invalid tenant id rejected; access-control metadata asserted; no secret fields in responses.

In-memory `node:test` suite (`search`, 8 cases) covers the usecase logic (secret rejection, permission filter, remove, reindex, readiness) without infra.

## Delivered

1. **Search model** — `search_documents` (migration 026): tenant-scoped, **RLS enabled + forced** (canonical inherit-aware predicate), maintained `tsvector` + **GIN index**, `UNIQUE (organisation_id, document_type, document_id)`, optional `permission_key`, `metadata`.
2. **Ports (DDD split)** — `SearchIndexPort` (write/lifecycle, server-internal) + `SearchQueryPort` (read), both satisfied by `PostgresSearchRepository` (`to_tsvector`/`plainto_tsquery`/`ts_rank`; tenant query under `withTenant` so RLS enforces; operator reindex/count under `withSystemAdmin`).
3. **Search usecase** — `indexDocument` (rejects secret-bearing metadata keys + empty title), `removeDocument`, `searchProducts` (plain-text query only; permission-aware; no body/secret in results), `reindexTenant` (operator-only, **audited** `search.reindexed`), `getSearchReadiness` (never faked — `blocked`/`degraded`/`ready`).
4. **Routes** (+ OpenAPI): `POST /api/org/search` (tenant, permission-aware), `GET /api/admin/search/readiness` (operator), `POST /api/admin/search/reindex` (operator).
5. **Permissions** — `tenant.search.read` (tenant), `platform.search.read|write` (operator) in `domain-identity`.
6. **UI** — `/admin/search`: tenant search test (query → ranked hits) for all; operator readiness card + tenant-select reindex for `platform.search.write`. REST-over-BFF; React renders hits only.
7. **Contracts** — search request/hit/response/readiness/reindex schemas in `@platform/contracts-admin`; `search` audit resource + `search.reindexed` action.

## Enforced invariants (proven)

Tenant A never sees tenant B's documents (RLS + tenant-scoped query); permission filter applied server-side; plain-text query parsed via `plainto_tsquery` (never raw `tsquery` from the client); secret-bearing documents rejected at index time; results carry no body/secret fields; deleted documents disappear; empty/invalid queries rejected safely; search is BFF-only; reindex audited; readiness never faked; no secret columns.

## Still NOT delivered (explicitly)

- **Composed search engine** (Meilisearch / Typesense / OpenSearch) — Phase 4.5, behind `SearchIndexPort`/`SearchQueryPort` (typo-tolerance, relevance tuning, index-per-tenant at scale).
- **Indexing producers** — search is a foundation; individual capabilities wire documents into `SearchIndexPort` incrementally (no producer is wired yet, so a fresh tenant index is empty until populated).
- Faceting, highlighting/snippets, synonyms, and analytics-grade search.

## Governance

- ADR-0060 **hardened to decision quality + Accepted** (Phase-4 foundation) on Matt's authority; the composed engine kept a Proposed Phase-4.5 sub-decision. CODEMAPS updated (ADR-0060 → Accepted).
- Registry: `search-indexing` → **locally proven** (decision **build**, Postgres FTS). `delivery` gains a `phase-4` gate (requires ADR-0060 ready). Validator + matrix re-rendered.

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, all prior proofs, `proof:search` (live), `proof:search-isolation` (live), `proof:search-routes` (live), `audit:osv`, `audit:deps`, `make check`.
