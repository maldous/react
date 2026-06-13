# ADR-0060: Search and indexing architecture

## Status

Accepted (2026-06-13, ADR-ACT-0258 — Phase 4; accepted on Matt's authority per the directive). The composed-engine option (Meilisearch / Typesense / OpenSearch) remains a **Proposed** Phase-4.5 provider sub-decision (not delivered).

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; security; AI assistant (drafting, human review required).

## Context

`search-runtime` was a port-only scaffold (interfaces + in-memory stub). There was no search engine, adapter, route, or UI. The existing Loki log search (ADR-0035) is operational log search, **not** product search. A universal foundation needs tenant-scoped, permission-aware full-text and filtered search with index lifecycle and reindex. Phase 4 delivers the **built-in Postgres full-text foundation**; a composed engine is a later provider behind the same ports.

## Decision (Phase 4 — accepted)

1. **Built-in Postgres full-text search (build):** `search_documents` (migration 026) with a maintained `tsvector`, GIN index, and `to_tsvector`/`plainto_tsquery`/`ts_rank` ranking. This is the default product-search engine; **no new composed service**.
2. **Tenant isolation (RLS):** documents are tenant-scoped with the canonical inherit-aware RLS predicate; tenant queries run under `withTenant` so RLS enforces isolation at the database, not just the query.
3. **Permission-aware queries:** each document may carry a `permission_key`; rows with one only appear when the caller holds that permission (filtered server-side). `q` is plain text parsed via `plainto_tsquery` — never raw `tsquery` from the client.
4. **No secret indexing:** the index step rejects documents carrying secret-bearing metadata keys; results never include the body or secret fields.
5. **Two ports:** `SearchIndexPort` (write/lifecycle, server-internal) and `SearchQueryPort` (read), both satisfied by the Postgres adapter today. Indexing is server-internal (producers push documents); the tenant query route is read-only + BFF-only. Reindex is operator-only + audited.
6. **Readiness:** search health is an operator readiness signal (`postgres-fts`), never faked (`blocked` if unreachable, `degraded` if empty).

## Decision (Proposed sub-decision — NOT delivered)

1. **Composed engine (Phase 4.5, compose/adapter, deferred):** Meilisearch or Typesense (light OSS) — or OpenSearch for heavy analytical search — added behind the same `SearchIndexPort`/`SearchQueryPort`, with index-per-tenant for hard isolation, only when scale/relevance needs prove it. **A container is not a capability**; no engine is composed in Phase 4.

### Alternatives considered

1. **Built-in Postgres FTS now; composed engine later behind the port (chosen).** Reuses the proven RLS pattern, zero new compose burden, fully live-provable; honest about the provider follow-up.
2. **Meilisearch/Typesense now.** Better relevance/typo-tolerance at scale, but adds an always-on service + index-lifecycle pipeline before a proven need; deferred to Phase 4.5 behind the port.
3. **OpenSearch now.** Heavy; only justified by analytical search at volume. Deferred.

### Rejected alternatives (required)

- **Loki log search as product search** — rejected: Loki is operational logs (ADR-0035), not product search.
- **React-side filtering as search** — rejected: not authoritative, not scalable, leaks the full dataset to the client.
- **Cross-tenant shared index without a tenant filter** — rejected: tenant isolation is enforced by RLS + tenant-scoped queries.
- **Search results without permission filtering** — rejected: `permission_key` filtering is applied server-side.
- **Indexing secret fields** — rejected: the index step rejects secret-bearing metadata; results carry no body/secret fields.
- **Claiming Meilisearch without live proof** — rejected: only the built-in Postgres engine is delivered + proven; the composed engine stays Proposed until live-proven.

### Accepted decision

Adopt option 1 for Phase 4: built-in Postgres FTS, RLS-isolated, permission-aware, server-internal indexing, operator reindex + readiness. The composed engine is a Phase-4.5 provider behind the same ports.

## Implementation phases

1. **Substrate (Phase 4, done):** migration 026 `search_documents` (RLS), `SearchIndexPort` + `SearchQueryPort`, `PostgresSearchRepository`, `search` usecase (index/remove/search/reindex/readiness; secret-field rejection).
2. **Surfaces (Phase 4, done):** `POST /api/org/search`, `GET /api/admin/search/readiness`, `POST /api/admin/search/reindex` (+ OpenAPI); `/admin/search` UI (tenant search test + operator readiness/reindex).
3. **Provider (Phase 4.5, future):** Meilisearch/Typesense adapter behind the ports + service-catalog provider entry + readiness + index-per-tenant.

## Acceptance criteria

- Tenant A's search never returns tenant B's documents (RLS-enforced); permission filter hides rows the caller can't see; secret-bearing documents are rejected; results carry no body/secret fields; deleted documents disappear; empty/invalid queries rejected safely; search is BFF-only; readiness reports honestly.
- `proof:search`, `proof:search-isolation`, `proof:search-routes` pass against live Postgres (SKIP honestly if unavailable).

## Proof requirements

`proof:search`, `proof:search-isolation`, `proof:search-routes` (live Postgres). In-memory `node:test` suite (`search`) for usecase logic. No registry status upgrade from a skipped proof.

## Production blockers

- Relevance/typo-tolerance and very large corpora should move to a composed engine (Phase 4.5) behind the port.
- Producers must wire documents into `SearchIndexPort` per capability (search is a foundation; indexing producers are added incrementally).

## Consequences

Positive: clean tenant isolation via RLS; zero new compose burden; fully live-proven; reuses the existing port.

Negative: Postgres FTS lacks typo-tolerance/relevance tuning of a dedicated engine (mitigated by the Phase-4.5 provider path); index-per-tenant scaling is a future-engine concern.

Neutral / operational: search observability folds into the observability substrate (ADR-0062).

## Validation / evidence

Evidence level: Medium (tenant-isolation risk). Local proof via the three Phase-4 proofs + the `search` node:test suite. Evidence: `docs/evidence/platform/phase-4-search.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0258; ADR-ACT-0244 search discovery).

## References

ADR-0035, ADR-0053, ADR-0055, ADR-0059, ADR-0062.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0258) on Matt's authority per the directive. The composed search engine (Meilisearch/Typesense/OpenSearch) is explicitly NOT delivered here — Phase 4.5, behind the same ports.
