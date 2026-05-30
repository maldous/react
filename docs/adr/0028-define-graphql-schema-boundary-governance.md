# ADR-0028: Define GraphQL schema boundary governance

## Status

Accepted

## Date

2026-05-29

## Decision owner

Architecture owner / technical lead.

## Consulted

- Product owner
- Engineering team
- Security reviewer

## Context

ADR-0013 established GraphQL as the primary client-facing API boundary. The platform has `@platform/contracts-graphql`, `@platform/adapters-graphql`, and `@platform/graphql-api-runtime` packages that implement this boundary.

As schema growth begins (new types, mutations, subscriptions), the boundary needs explicit governance to prevent:

- Schema drift between contract package and runtime resolver
- Direct client coupling to implementation details via over-exposed fields
- Unreviewed breaking changes to existing consumers
- Schema-level data-ownership violations (resolvers accessing data outside their bounded context)

Without this decision, schema growth fragments organically and reverting accidental over-exposure or cross-context coupling becomes expensive.

## Decision

GraphQL schema governance follows three rules:

### 1. Schema-first in the contract package

All GraphQL types, queries, mutations, and subscriptions are defined in `@platform/contracts-graphql` first. The runtime package `@platform/graphql-api-runtime` may only expose types declared in the contract. No type may appear in a resolver without a matching contract declaration.

The import-boundary rule `no-architecture-in-product` already enforces that adapters do not bleed into domain packages. The complementary rule here is that resolvers are adapters ? they must import from contracts, never from domain packages directly.

### 2. Breaking changes require architecture review

A breaking change is any schema change that removes a field, changes a field type, changes nullability in a non-widening direction, or removes an enum value. Breaking changes require an `architecture-review` change-control entry in the relevant package's `package.json` governance block and a linked ADR-ACT entry before merge.

Additive changes (new types, new optional fields, new enum values) do not require architecture review but do require the contract package version to increment under the repo's internal semver policy.

### 3. Resolver data ownership matches bounded-context ownership

A resolver may only read from or write to the bounded context that owns the underlying data, as defined in ADR-0014 (transactional data ownership). Cross-context reads must go through a published use-case or domain service ? never through a direct adapter import.

This rule is enforced by the import-boundary validator (`validate-source-imports`) which already prevents adapters from appearing in domain packages. No additional tooling is required; the hexagonal architecture's existing import rules enforce this.

## Consequences

**Positive:**

- Schema drift is caught at the contract layer before runtime wiring
- Breaking changes are visible in governance metadata before they reach consumers
- Data-ownership violations are caught by the existing import boundary gate (no additional tooling)
- Schema evolution is predictable: additive by default, breaking by explicit review

**Negative:**

- Schema-first adds a step before resolver implementation; acceptable given the small team size and existing ADR workflow
- Architecture review for breaking changes adds latency; acceptable given that client-breaking changes should be rare at this stage

## Alternatives considered

**Schema-last (generate from resolvers):** Rejected. Schema-last couples the API surface to implementation details and makes breaking-change detection harder.

**Separate schema registry:** Considered for future scale. Deferred ? the current package boundary (`@platform/contracts-graphql`) provides equivalent isolation at this team size.

## Links

- ADR-0001: Hexagonal architecture (import boundary rules)
- ADR-0002: Bounded contexts (data ownership)
- ADR-0013: GraphQL as primary client-facing API boundary
- ADR-0014: Transactional data ownership
- ADR-ACT-0015: This ADR fulfils ADR-ACT-0015
