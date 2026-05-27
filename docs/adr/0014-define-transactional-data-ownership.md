# ADR-0014: Define transactional data ownership

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

The platform manages transactional data: profile configuration, role assignments, operational state, session state, and audit records.

Without a defined transactional data ownership boundary, persistence concerns bleed into domain packages. Repository implementations scatter across the codebase. Migration tooling lacks a single owner.

The package structure already includes:

```text
@platform/domain-core
@platform/profile-configuration
@platform/access-control
@platform/adapters-postgres
```

This ADR formalises which package owns transactional data persistence and what the boundary rules are.

## Stakeholder concerns

- Product:
  - Profile, preferences, and role data must be persisted reliably.
  - Data consistency during product operations must be ensured.

- Engineering:
  - Domain packages must remain free of database client imports.
  - Repository implementations must not leak into feature packages.
  - Schema migrations must be owned by a single package.

- Security:
  - Access to transactional data must be gated by access-control rules.
  - Connection credentials must not be visible outside the adapter layer.
  - Audit records must be tamper-resistant.

- Operations:
  - PostgreSQL connection pooling and health must be observable.
  - Migration tooling must run in CI and in deployment pipelines.

- Compliance/governance:
  - Data ownership must be traceable to a governed package.
  - Data retention and deletion must be enforceable at the adapter layer.

## Decision drivers

- Keep domain packages free of PostgreSQL client imports.
- Keep contract packages free of runtime adapters.
- Own schema migrations in a single package.
- Support access-control gating at the domain layer, not at the adapter layer.
- Support observability at the adapter boundary.

## Options considered

### Option A: Persistence in domain packages

Description:

Allow domain packages to include repository implementations and depend on a database client directly.

Pros:

- Domain objects and persistence are co-located.
- Simple initial setup.

Cons:

- Domain packages import infrastructure dependencies.
- Domain logic becomes tightly coupled to PostgreSQL.
- Migrating persistence becomes a domain change.

Risks:

- Domain packages cannot be tested without a database.
- Persistence concerns contaminate business logic.

### Option B: Persistence in a shared adapter package

Description:

Own all transactional persistence in `@platform/adapters-postgres`. Domain packages define models and interfaces. The adapter provides repository implementations.

Pros:

- Domain packages remain pure TypeScript policy and model packages.
- Persistence technology can change without touching domain packages.
- Schema migrations are owned by one package.
- Repository implementations are testable independently of domain logic.

Cons:

- Adapter package grows large as the domain grows.
- Domain packages must define persistence interfaces that the adapter implements.

Risks:

- Adapter package becomes a dependency dumping ground if boundaries are not enforced.

### Option C: Persistence in feature packages

Description:

Allow feature packages to own persistence logic and depend on a database client.

Pros:

- Feature teams own their own data.

Cons:

- Multiple packages compete to own overlapping data.
- Migration tooling is fragmented.
- Feature packages become infrastructure-aware.

Risks:

- Data consistency across features is hard to govern.
- Circular dependencies emerge between feature and domain packages.

## Decision

`@platform/adapters-postgres` owns all transactional data persistence.

Transactional data is:

```text
profile configuration
role assignments
operational state
session state
audit records
transactional business data
```

Domain packages (`@platform/domain-core`, `@platform/profile-configuration`, `@platform/access-control`) define models, value objects, and repository interfaces.

`@platform/adapters-postgres` provides the repository implementations and owns:

```text
PostgreSQL schema definitions
schema migration tooling
connection pool management
repository implementations for domain interfaces
```

`@platform/adapters-postgres` may import:

```text
@platform/profile-configuration
@platform/access-control
```

`@platform/adapters-postgres` must not be imported by:

```text
domain packages
contract packages
feature packages
UI packages
operations interface packages
```

Access-control gating happens at the domain layer. `@platform/adapters-postgres` applies domain access policy through the interfaces provided by `@platform/access-control`, but does not own access policy itself.

## Rationale

Centralising transactional persistence in `@platform/adapters-postgres` keeps domain packages infrastructure-free.

Domain packages can be tested without a database. Persistence technology can change without modifying domain logic.

Owning schema migrations in a single package gives migration tooling a clear home and avoids competing migration sources.

Keeping the adapter out of feature, contract, and UI packages enforces the hexagonal boundary defined in ADR-0001.

## Consequences

Positive:

- Domain packages remain pure TypeScript policy and model packages.
- Schema migrations have a single owner.
- Domain logic is testable without PostgreSQL.
- Persistence technology is replaceable without touching domain packages.

Negative:

- Domain packages must define repository interfaces explicitly.
- The adapter package grows as the domain grows.

Neutral / operational:

- Connection pooling and observability are adapter responsibilities.
- Migrations run in CI and deployment pipelines.
- `@platform/adapters-postgres` is a production runtime package.

Future consequences:

- Implement PostgreSQL schema and repository layer during first vertical slice.
- Govern migration strategy (forward-only, squash policy).
- Validate adapter import rules via `tools/architecture/validate-source-imports`.

## AI-assistance record

AI used: Yes

- Tool/model:
  - Claude Code

- Assistance scope:
  - Drafting, consistency review, and constraint validation against existing ADRs and package structure.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - Package structure in packages/.
  - Import boundary rules in docs/architecture/import-boundary-rules.md.
  - Context map in docs/architecture/context-map.md.
  - ADR-0001 through ADR-0013.
  - ACTION-REGISTER.md.

- Validation required:
  - Validate against first vertical slice implementation.
  - Confirm repository interface pattern across domain packages.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- `@platform/adapters-postgres` package exists with adapter role metadata.
- `@platform/domain-core`, `@platform/profile-configuration`, `@platform/access-control` exist with platform role metadata.
- Import boundary rules document the adapter/domain separation.
- `@platform/adapters-postgres` `forbiddenConsumers` list prevents import by feature, domain, and UI packages.

Further validation required:

- Implement PostgreSQL schema and repository implementations.
- Confirm domain interface pattern during first vertical slice.
- Validate import rules against first vertical slice.

## Impacted areas

- Architecture:
  - Defines transactional data ownership boundary.

- Data:
  - PostgreSQL is the transactional data store.
  - Schema migrations owned by `@platform/adapters-postgres`.

- Security:
  - Database credentials visible only inside the adapter package.
  - Access-control gating applied through domain interfaces.

- Operations:
  - Connection pool management and health owned by the adapter.

- Testing:
  - Domain logic testable without a database.
  - Repository integration tests run against a real PostgreSQL instance.

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
  - docs/adr/0005-define-package-metadata-format.md

- Architecture documentation:
  - docs/architecture/import-boundary-rules.md
  - docs/architecture/context-map.md
  - docs/architecture/domain-glossary.md

- Related action register items:
  - ADR-ACT-0005: Create the transactional data ownership ADR.

## Notes

This ADR defines transactional data ownership.

This ADR does not define analytical data ownership (see ADR-0015).

This ADR does not define the PostgreSQL schema or migration tooling implementation.

This ADR does not define data retention, deletion, or compliance policies.
