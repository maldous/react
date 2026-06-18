# ADR-0013: Define client-facing API boundary

## Status

Accepted

## Date

2026-05-27

## Decision owner

Architecture owner / technical lead.

## Consulted

- Product owner
- Engineering team
- Security reviewer
- Operations reviewer
- Architecture review support

## Context

The platform is structured as a modular hexagonal monorepo (ADR-0001) around bounded contexts (ADR-0002) with governed package boundaries (ADR-0003).

The client-facing API boundary is the surface through which external consumers ? the React application, mobile clients, and third-party integrators ? interact with platform services.

Without a defined API boundary decision, client integration patterns fragment across packages. Consumer contracts become implicit. API versioning and access-control integration lack a consistent anchoring point.

The package structure already includes:

```text
@platform/contracts-graphql
@platform/adapters-graphql
@platform/graphql-api-runtime
@platform/api-runtime
```

This ADR formalises the client-facing API boundary and defines which packages own which responsibilities.

## Stakeholder concerns

- Product:
  - The React client must have a stable, typed API contract.
  - The BFF pattern allows product-specific query shapes without polluting domain packages.

- Engineering:
  - Client contracts must be defined in a contract package, not in runtime or adapter packages.
  - Schema changes must be reviewed before client consumption changes.

- Security:
  - API access must be authenticated and authorised.
  - The API boundary is the primary enforcement point for request authentication.

- Operations:
  - The API server must be observable, configurable, and independently deployable.
  - Runtime health, rate limiting, and circuit-breaking belong to the API runtime, not to domain logic.

- Compliance/governance:
  - External-facing APIs must be versioned or have a stated versioning policy.
  - API contract changes must be governed by architecture review.

## Decision drivers

- Keep domain packages free of transport concerns.
- Keep contract packages free of runtime adapters.
- Support typed client consumption from the React application.
- Support access-control integration at the API boundary, not inside domain packages.
- Support observability at the API boundary.
- Keep the initial API technology decision reversible at the adapter layer.

## Options considered

### Option A: REST-only API boundary

Description:

Expose all client-facing operations through a REST API served by `@platform/api-runtime`.

Pros:

- Simple HTTP semantics.
- Broad tool support.
- Easy caching.

Cons:

- No standard contract typing for the React client.
- Over-fetching and under-fetching are common.
- Multiple endpoints required for composed product views.

Risks:

- Client contracts become implicit in documentation rather than machine-checkable schemas.
- REST versioning accumulates breaking-change debt.

### Option B: GraphQL BFF as primary API boundary with REST supplement

Description:

Use GraphQL served by `@platform/graphql-api-runtime` as the primary client-facing API. Use `@platform/api-runtime` for supplementary REST endpoints not suited to GraphQL (webhooks, file upload, health probes, third-party integration callbacks).

Pros:

- Typed schema contract available to the React client.
- Query shapes are consumer-driven without over-fetching.
- Schema-first design enforces separation between contract and runtime.
- Access-control and observability integrate cleanly at the resolver layer.

Cons:

- GraphQL runtime is more complex than REST.
- Schema design requires governance discipline.

Risks:

- N+1 query risks if resolver design is not governed.
- Schema drift if contract package and runtime adapter are not kept in sync.

### Option C: tRPC or other typed RPC mechanism

Description:

Use a typed RPC mechanism that generates contracts directly from TypeScript types.

Pros:

- Strong type safety end-to-end.
- Minimal schema design overhead.

Cons:

- Client-server type coupling is tight.
- Less suited for third-party API consumption.
- No standard tool support for external clients.

Risks:

- Locks client and server to a shared TypeScript codebase.
- Hard to support non-TypeScript consumers.

## Decision

Use GraphQL as the primary client-facing API boundary.

`@platform/contracts-graphql` owns the GraphQL schema contracts.

`@platform/graphql-api-runtime` owns the GraphQL server runtime.

`@platform/adapters-graphql` owns the runtime binding between contracts and adapters.

`@platform/api-runtime` provides the underlying HTTP server and access-control integration for supplementary REST endpoints (health probes, webhooks, file upload, third-party integration callbacks).

The React application (`@platform/react-enterprise-app`) imports from feature packages (`@platform/feature-workflow`) and from the GraphQL adapter (`@platform/adapters-graphql`) for runtime client configuration. The React application does not import from domain, contract, or operations packages directly.

API access is authenticated via `@platform/security-auth` and `@platform/adapters-keycloak`.

> **Supersession note (ADR-ACT-0288, 2026-06-18):** `@platform/security-auth`, `@platform/feature-workflow`, and `@platform/access-control` referenced here are now **deprecated** (ADR-0006) — never wired (zero source consumers). Authentication/authorisation is delivered by `authorisation-runtime` + `adapters-keycloak` and platform-api server-side authz; the workflow feature was speculative and is unimplemented. The historical boundary description above is left intact.

The allowed client-side API import boundary is:

```text
@platform/react-enterprise-app may import:
  @platform/feature-workflow
  @platform/adapters-graphql (client configuration only)
  @platform/access-control (role-aware composition)
```

The GraphQL schema boundary is governed by ADR-ACT-0015.

## Rationale

GraphQL provides a typed, schema-first contract that supports the React client's need for composed, product-driven query shapes.

Keeping schema contracts in `@platform/contracts-graphql` and runtime binding in `@platform/adapters-graphql` maintains the hexagonal boundary between contracts and adapters.

The BFF pattern lets the product team shape API operations without modifying domain logic. Domain packages remain pure TypeScript policy and model packages with no transport concerns.

Supplementary REST endpoints via `@platform/api-runtime` support integrations that are not well-suited to GraphQL (webhooks, callbacks, health endpoints).

Formalising the API boundary in an ADR prevents implicit client integration paths from forming outside the governed package boundary.

## Consequences

Positive:

- React client has a typed API contract.
- Contract ownership is explicit.
- Access-control integration is anchored at the API boundary.
- Domain packages remain transport-free.
- Schema-first design supports tooling (codegen, documentation, mocking).

Negative:

- GraphQL runtime requires more initial setup than REST.
- N+1 query prevention requires resolver governance.

Neutral / operational:

- Schema changes require architecture review before client consumption changes.
- REST supplement (`@platform/api-runtime`) is available for non-GraphQL integrations.
- GraphQL schema boundary governance is deferred to ADR-ACT-0015.

Future consequences:

- Define GraphQL schema boundary management (ADR-ACT-0015).
- Govern schema versioning and breaking-change policy.
- Enforce API boundary import rules via `tools/architecture/validate-source-imports`.

## AI-assistance record

AI used: Yes

- Tool/model:
  - Claude Code

- Assistance scope:
  - Drafting, consistency review, and constraint validation against existing ADRs and package structure.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - Package structure in apps/ and packages/.
  - Import boundary rules in docs/architecture/import-boundary-rules.md.
  - Context map in docs/architecture/context-map.md.
  - ADR-0001 through ADR-0012.
  - ACTION-REGISTER.md.

- Validation required:
  - Validate against first vertical slice implementation.
  - Confirm GraphQL schema boundary governance (ADR-ACT-0015).

## Validation / evidence

Evidence level:

Medium

Evidence used:

- `@platform/contracts-graphql` package exists with contract role metadata.
- `@platform/adapters-graphql` package exists with adapter role metadata.
- `@platform/graphql-api-runtime` package exists with platform role metadata.
- `@platform/api-runtime` package exists with platform role metadata.
- Import boundary rules document the client API boundary.

Implemented (2026-06-09, ADR-ACT-0199):

- First GraphQL endpoint live: `POST /api/graphql` in apps/platform-api (server/graphql.ts), serving the session-scoped `organisationProfile` query and `updateOrganisationProfile` mutation.
- Contract/adapter split exercised end-to-end: SDL in `@platform/contracts-graphql`, schema build/execution via `@platform/graphql-api-runtime`/`@platform/adapters-graphql`, resolvers in the BFF over the existing use-cases.
- Access control integrated at the endpoint: per-operation UMA authorisation (UMA-first → static fallback → fail-closed) mirroring the REST route gate; endpoint hardened with an operation allowlist and introspection disabled outside development.
- The browser SPA consumes the boundary over plain fetch (it must not import graphql/adapters per ADR-0022); response types come from `@platform/contracts-organisation`.

Further validation required:

- Extend the GraphQL boundary to remaining application data as further slices land.
- Define schema versioning / persisted-operation policy before GA (ADR-ACT-0015).

## Impacted areas

- Architecture:
  - Defines client-facing API boundary.

- API:
  - GraphQL schema contracts in `@platform/contracts-graphql`.
  - GraphQL runtime in `@platform/graphql-api-runtime`.

- Security:
  - Access-control integrated at the API boundary via `@platform/security-auth`.

- Operations:
  - API observability and health probes via `@platform/api-runtime`.

- Delivery:
  - GraphQL schema codegen via `@platform/tooling-codegen`.

- UX:
  - React application consumes typed GraphQL client generated from contracts.

## Follow-up actions

Material follow-up actions are not tracked inside this ADR.

They are coordinated through:

```text
docs/adr/ACTION-REGISTER.md
```

## Review date

2026-08-27

## Supersedes

None.

## Superseded by

None.

## References

- Accepted ADRs:
  - docs/adr/0001-use-modular-hexagonal-architecture.md
  - docs/adr/0002-model-the-platform-around-bounded-contexts.md
  - docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
  - docs/adr/0004-define-package-lifecycle-classes.md
  - docs/adr/0005-define-package-metadata-format.md
  - docs/adr/0006-define-package-lifecycle-transition-rules.md

- Architecture documentation:
  - docs/architecture/import-boundary-rules.md
  - docs/architecture/context-map.md

- Related action register items:
  - ADR-ACT-0004: Create the client-facing API boundary ADR.
  - ADR-ACT-0015: Create an ADR for GraphQL schema boundary management.

## Notes

This ADR defines the client-facing API boundary technology and ownership.

This ADR does not define GraphQL schema versioning or schema boundary management (see ADR-ACT-0015).

This ADR does not define REST API versioning policy.

This ADR does not define client-side state management or cache behaviour.
