# ADR-0060: Search and indexing architecture

## Status

Proposed

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; security; AI assistant (drafting, human review required).

## Context

`search-runtime` is a port-only scaffold (interfaces + in-memory stub). There is no search engine, adapter, route, or UI. The existing Loki log search (ADR-0035) is operational log search, **not** product search. A universal foundation needs tenant-scoped, permission-aware full-text and filtered search with index lifecycle and reindex jobs.

## Decision

1. **Compose Meilisearch or Typesense** (light OSS, low compose burden) as the default product-search engine; reserve OpenSearch for heavy analytical search if proven necessary.
2. **Per-environment**; prefer **index-per-tenant** for hard isolation, with permission-aware query filters at the BFF.
3. Implement behind the existing `SearchPort`; provide a local adapter for proof and reindex jobs via the workflow/queue substrate (ADR-0059).
4. Index health is a readiness signal in the service catalog.

## Consequences

Positive: clean tenant isolation; low operational burden; reuses the existing port.

Negative: index-per-tenant scales index count with tenants; reindex pipelines add complexity.

Neutral / operational: search observability folds into the observability substrate (ADR-0062).

## Validation / evidence

Evidence level: Medium. New `proof:search` covering tenant isolation + permission-aware results required before delivery.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0244).

## References

ADR-0035, ADR-0053, ADR-0059.

## Notes

Proposed; acceptance requires human review. Loki log search remains separate.
