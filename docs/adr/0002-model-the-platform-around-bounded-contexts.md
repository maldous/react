# ADR-0002: Model the platform around bounded contexts

## Status

Accepted

## Date

2026-05-26

## Decision owner

Architecture owner / technical lead.

## Consulted

- Product owner
- Engineering team
- Domain stakeholders
- Security reviewer
- Data reviewer
- Operations reviewer
- Architecture review support

## Context

Modular hexagonal architecture is the base architectural style.

The next decision is how to divide the product into coherent business areas before defining packages, database ownership, API boundaries, or delivery slices.

A professional-grade platform needs stable domain language and clear ownership boundaries.

Without bounded contexts, the product risks becoming organised around technical layers, database tables, UI screens, or framework conventions instead of business capability.

That creates predictable problems:

- duplicated concepts
- unclear ownership
- inconsistent naming
- accidental coupling
- weak test boundaries
- unclear API boundaries
- data ownership confusion
- delivery slices that cut across too many unrelated areas

The product needs a model that supports growth, integration, analytics, operations, and governance without prematurely splitting into distributed services.

ADR-0004 uses package `domain` metadata to associate packages with bounded contexts or shared areas.

This ADR therefore provides the source of truth for package domain values, but the exact package metadata format is defined separately.

Vocabulary used for bounded contexts must align with ADR-0001's language principle.

ADR-0002 owns the business/domain vocabulary layer.

Domain terms should align primarily with Domain-Driven Design and bounded-context language.

Where a package or system must later be discoverable through a software catalog, the same domain vocabulary should also be compatible with Backstage-style `domain`, `system`, `component`, and `owner` concepts.

This does not mean ADR-0002 adopts Backstage catalog descriptors as a source of truth.

It means ADR-0002 provides domain values that can later be projected into Backstage-compatible catalog views without translation.


Vocabulary clarification:

```text
domain
  business or platform area used as a package metadata domain value

bounded context
  domain boundary with internally consistent language and ownership

module
  implementation unit inside a bounded context

package
  package-manager/repository unit defined by ADR-0003 and described by ADR-0005 metadata

component/system/owner
  Backstage-compatible catalog projection terms, not separate sources of truth
```



## Stakeholder concerns

- Product:
  - Product capabilities should map to understandable business areas.
  - Roadmaps and features should be expressible in product/domain language.
  - Delivery slices should have clear scope.

- Engineering:
  - Implementation modules should have clear responsibilities.
  - Cross-module dependencies should be intentional and should not bypass package or bounded-context rules.
  - Teams should avoid shared generic services that become dumping grounds.

- Security:
  - Access rules should be tied to domain ownership.
  - Sensitive operations should have clear control points.

- Operations:
  - Failures should map to understandable product capabilities.
  - Operational dashboards and runbooks should align with system boundaries.

- Data:
  - Data ownership should be explicit.
  - Transactional, analytical, imported, and derived data should not be mixed accidentally.

- Users/customers:
  - Product behaviour should be consistent across screens and workflows.
  - Terms used in the UI should reflect stable domain concepts.

- Compliance/governance:
  - Ownership, audit, retention, and access policies should be assignable to domain areas.
  - Material decisions should remain traceable.

- Support:
  - Support should be able to identify which part of the product owns a behaviour or failure.

## Decision drivers

- Establish stable domain language early.
- Avoid organising the product around technical layers.
- Support modular hexagonal architecture.
- Support vertical-slice delivery.
- Make data ownership clearer.
- Make API boundaries clearer.
- Avoid premature microservices.
- Keep context boundaries understandable to product, engineering, data, and operations.
- Allow contexts to evolve as the domain is learned.
- Avoid over-fragmenting the system too early.
- Provide the source of truth for package domain metadata values.
- Align domain vocabulary with ADR-0001 language principles and ADR-0005 package metadata vocabulary.

## Options considered

### Option A: Organise around technical layers

Description:

Structure the product around layers such as UI, API, services, repositories, database, and jobs.

Pros:

- Familiar.
- Easy to start.
- Aligns with many framework examples.
- Simple initial folder layout.

Cons:

- Product concepts spread across many layers.
- Delivery slices cut through many unrelated files.
- Business ownership becomes unclear.
- Shared service layers tend to collect unrelated behaviour.
- Domain language is weaker.

Risks:

- Product complexity becomes hidden inside generic services.
- Business rules become difficult to locate.
- Data ownership becomes unclear.

### Option B: Organise around database entities

Description:

Structure the platform around core tables or entities such as users, accounts, assets, events, reports, and results.

Pros:

- Simple mapping to persistence.
- Easy for CRUD-heavy features.
- Familiar to database-focused teams.

Cons:

- Database shape starts defining the product model.
- Concepts with different meanings may be forced into the same entity.
- Read models, write models, and analytical models may become confused.
- Business workflows are harder to represent.

Risks:

- Domain model becomes an anemic database wrapper.
- Future API and UI behaviour becomes constrained by early table design.
- Analytical and transactional concerns become mixed.

### Option C: Organise around UI screens or user journeys

Description:

Structure the code around visible screens, pages, or user workflows.

Pros:

- Good alignment with frontend delivery.
- Easy to reason about immediate user-facing features.
- Supports rapid prototyping.

Cons:

- Shared domain rules may be duplicated across screens.
- Backend and data ownership remain unclear.
- Cross-channel reuse becomes harder.
- Domain concepts may be named differently in different screens.

Risks:

- UI behaviour becomes the source of truth.
- Business rules become fragmented.
- Non-UI capabilities such as ingestion, analytics, and operations become second-class.

### Option D: Organise around bounded contexts

Description:

Define business capability boundaries with their own language, models, use cases, data ownership, and adapters.

Initial contexts are defined at product/domain level, not as separately deployed services.

Pros:

- Aligns with modular hexagonal architecture.
- Keeps business language explicit.
- Supports clear ownership.
- Supports vertical-slice delivery.
- Makes data and API boundaries easier to define.
- Allows future extraction if a context needs independent deployment.
- Avoids premature microservices.

Cons:

- Requires domain modelling discipline.
- Boundaries may need revision as the product is better understood.
- Some cross-context workflows need explicit coordination.
- Initial context names may be imperfect.

Risks:

- Over-fragmentation if contexts are too small.
- Under-fragmentation if contexts are too broad.
- Boundary disagreements may slow early design unless review rules are clear.

## Decision

Model the platform around bounded contexts.

Bounded contexts will define the primary product/domain boundaries inside the modular architecture.

Contexts will initially be modular boundaries within the same repository and runtime, not independently deployed microservices.

Each context should own its language, use cases, domain rules, and data responsibilities where practical.

Initial context candidates are:

- identity-and-access
- customer-and-account
- portfolio
- market-data
- asset-modelling
- simulation
- analytics
- reporting
- integration
- operations

These names are starting points and must be validated through early vertical slices.

The bounded context map and domain glossary are the source of truth for package `domain` metadata.

Package metadata should not invent domain values independently.

Package metadata may project those values into Backstage-compatible `domain`, `system`, `component`, and `owner` fields.

## Rationale

Bounded contexts best support the modular hexagonal architecture.

They provide a practical way to separate product capability without prematurely distributing the system.

They allow the product to develop a stable domain language before database schemas, API contracts, and UI screens harden around accidental names.

Technical layers, database entities, and UI screens are useful internal organisation tools, but they should not be the primary architectural boundaries.

Bounded contexts make it easier to decide later:

- which modules own which data
- which APIs expose which capabilities
- which teams own which areas
- which tests validate which behaviours
- which operations dashboards map to which capabilities
- which contexts may need independent scaling or deployment later

## Consequences

Positive:

- Product and engineering can share clearer domain language.
- Domain concepts are less likely to be diluted by technical naming.
- Data ownership decisions become easier.
- API schema boundaries become clearer.
- Vertical slices can be scoped by capability.
- Future service extraction remains possible without starting with microservices.
- Support and operations can map failures to product areas.

Negative:

- Context boundaries require ongoing review.
- Early context names may change.
- Cross-context workflows need explicit coordination.
- Engineers may need guidance to avoid importing across context boundaries casually.
- Some duplicated concepts may be valid where contexts use the same words differently.

Neutral / operational:

- Context boundaries should be documented.
- Package and implementation-module structure should reflect context boundaries.
- Import rules should prevent accidental coupling.
- ADRs should be created when a context boundary materially changes.
- First vertical slices should validate whether the initial contexts are useful.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, and consistency review.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - Related ADRs.
  - ADR process requirements.
  - Stated architecture constraints.
  - Validation checks in the artifact set.

- Validation required:
  - Validate during first vertical slice.
  - Validate through implementation tooling where applicable.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- ADR-0001 accepted modular hexagonal architecture.
- Architecture reasoning based on domain ownership and separation of concerns.
- Comparison against technical-layer, database-entity, and UI-screen organisation.
- Expected product needs across product, data, integration, analytics, security, testing, and operations.

Further validation required:

- Produce an initial context map.
- Implement one vertical slice across the proposed contexts.
- Confirm that domain language remains clear.
- Confirm that context boundaries do not create excessive ceremony.
- Confirm that data ownership ADRs can refer cleanly to these contexts.

## Impacted areas

- Architecture:
  - Defines product/domain boundaries used inside the modular architecture.

- Data:
  - Future data ownership ADRs should align to context ownership.

- API:
  - GraphQL schema organisation should reflect context boundaries where practical.

- Security:
  - Access-control rules should be tied to context-owned capabilities.

- Operations:
  - Observability and support dashboards should map to product contexts.

- Testing:
  - Tests should be grouped around context-owned behaviour and vertical slices.

- Delivery:
  - Features should be sliced by product capability, not only by technical layer.

- UX:
  - UI language should align with domain language where possible.

- Documentation:
  - A context map and glossary should be created.

## Follow-up actions

Material follow-up actions are not tracked inside this ADR.

They are coordinated through:

```text
docs/adr/ACTION-REGISTER.md
```

This avoids duplicate sources of truth for action status.


## Review date

2026-06-26

## Supersedes

None.

## Superseded by

None.

## References

Record source material used during the decision.

Examples:

- Domain vocabulary references:
  - Domain-Driven Design bounded contexts.
  - Backstage catalog domain/system/component/owner concepts, for future projection only.

- Domain-Driven Design bounded contexts:
  - Eric Evans, Domain-Driven Design.
  - Martin Fowler, Bounded Context.
  - https://martinfowler.com/bliki/BoundedContext.html

- Architecture decision process:
  - docs/adr/README.md
  - docs/adr/0000-template.md
  - docs/adr/0001-use-modular-hexagonal-architecture.md

- Related ADRs:
  - docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
  - docs/adr/0004-define-package-lifecycle-classes.md

- Related future ADRs:
  - Package metadata format.
  - Import-boundary enforcement.
  - GraphQL schema boundaries.
  - Transactional data ownership.
  - Analytical data ownership.

## Notes

This ADR does not define final package names, database schemas, API types, ownership teams, or deployment units.

This ADR decides that bounded contexts are the primary product/domain boundary for the platform.

Specific context names may be revised through future ADRs as the domain becomes clearer.
