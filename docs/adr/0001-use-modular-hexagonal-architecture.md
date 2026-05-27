# ADR-0001: Use modular hexagonal architecture

## Status

Accepted

## Date

2026-05-26

## Decision owner

Architecture owner / technical lead.

## Consulted

- Product owner
- Engineering team
- Security reviewer
- Operations reviewer
- Architecture review support

## Context

We are defining the base architecture for a professional-grade product before committing to frameworks, data stores, API patterns, or deployment topology.

The product is expected to include:

- user-facing web interfaces
- backend application use cases
- domain modelling
- transactional data
- analytical data
- external integrations
- generated API contracts
- automated testing
- production operations
- AI-assisted development

The main risk is allowing framework, database, or UI choices to define the architecture accidentally.

If business rules are placed directly in React components, GraphQL resolvers, ORM models, database procedures, or integration adapters, the product becomes harder to test, change, govern, and operate.

The architecture needs clear boundaries so that product capability, domain rules, infrastructure, and delivery mechanisms can evolve independently.

Architecture vocabulary is part of the architecture.

Terms used for domains, bounded contexts, modules, packages, components, systems, ports, adapters, APIs, lifecycle states, ownership, runtime concerns, and operational support must be deliberate and consistent across ADRs.

Where practical, terms should align with established external vocabulary models so future consumers do not need translation mappings.

External schemas must not be adopted wholesale unless an ADR explicitly accepts them.

Later ADRs may specialise vocabulary for bounded contexts, package metadata, lifecycle classes, APIs, data ownership, CI, runtime concerns, and operations.

For ADR-0001, the term `module` is used generically for an architectural unit inside the hexagonal architecture.

Later ADRs specialise this vocabulary:

```text
bounded context
  product/domain boundary defined by ADR-0002

package
  package-manager and repository boundary defined by ADR-0003 and represented through package.json metadata in ADR-0005

component
  externally recognisable catalog/architecture concept aligned with Backstage and C4 where practical

container
  C4 architecture term for an application or data store that runs as a unit, not necessarily a Docker container
```

## Stakeholder concerns

- Product:
  - Features should be delivered in coherent vertical slices.
  - Product behaviour should remain understandable and explainable.
  - The architecture should not slow delivery unnecessarily.

- Engineering:
  - Business logic should be testable without databases, web servers, or UI frameworks.
  - Module boundaries should be clear.
  - Framework and vendor choices should remain replaceable where practical.

- Security:
  - Access-control decisions should live in predictable application/domain boundaries.
  - Security rules should not be scattered across UI and infrastructure code.

- Operations:
  - Runtime behaviour should be observable.
  - Failure boundaries should be clear.
  - External systems should be isolated behind adapters.

- Data:
  - Data ownership should be explicit.
  - Transactional and analytical responsibilities should not be mixed accidentally.

- Users/customers:
  - Product behaviour should be consistent.
  - System outputs should be explainable and traceable.

- Compliance/governance:
  - Material decisions should be auditable.
  - Data, access, and operational behaviour should be reviewable.

- Support:
  - Support engineers should be able to reason about where behaviour is implemented.
  - Known failure modes should map to clear system boundaries.

## Decision drivers

- Preserve domain and application logic independently from frameworks.
- Support vertical-slice delivery.
- Keep external systems replaceable through adapters.
- Make business rules easy to test.
- Make security and access-control boundaries explicit.
- Avoid premature microservices.
- Avoid framework-led architecture.
- Keep local development practical.
- Support future growth into multiple interfaces, integrations, and data stores.
- Maintain clear ownership of modules and dependencies.

## Options considered

### Option A: Simple layered architecture

Description:

Use a conventional layered structure such as controllers, services, repositories, and models.

Pros:

- Familiar to many engineers.
- Fast to start.
- Simple folder structure.
- Works well for small applications.

Cons:

- Business logic often leaks into controllers, resolvers, repositories, or ORM models.
- Boundaries are usually conventions rather than enforced rules.
- Services can become broad transaction scripts with unclear ownership.
- External integrations can become tightly coupled to application flow.

Risks:

- Architecture may degrade into framework-driven layering.
- Testing may require excessive mocking of infrastructure.
- Domain language may be diluted by technical concerns.

### Option B: Modular hexagonal architecture

Description:

Use explicit domain and application modules with ports and adapters.

Core domain and application logic define behaviour.

Infrastructure, databases, APIs, queues, external services, and UI frameworks are adapters around the core.

Pros:

- Keeps business rules independent from frameworks and infrastructure.
- Supports clear test boundaries.
- Allows databases and integrations to be replaced or isolated.
- Fits vertical-slice delivery.
- Works well in a modular monorepo.
- Makes dependency direction explicit.

Cons:

- More initial structure than a simple layered app.
- Requires discipline to avoid unnecessary abstractions.
- Can become over-engineered if every small detail gets a port too early.
- Engineers need shared conventions.

Risks:

- Poorly applied hexagonal architecture can create boilerplate without value.
- Excessive abstraction can slow delivery.
- Boundaries may become inconsistent without review.

### Option C: Microservices from the start

Description:

Split major product capabilities into independently deployed services early.

Pros:

- Strong runtime isolation.
- Independent scaling.
- Clear service ownership if the team is large enough.
- Can align well to mature organisational boundaries.

Cons:

- High operational complexity.
- More difficult local development.
- Requires mature deployment, observability, security, and data governance.
- Distributed transactions and cross-service reporting become harder.

Risks:

- Premature distribution.
- Slower delivery.
- More failure modes.
- Team spends more effort operating the platform than proving product capability.

### Option D: Framework-led architecture

Description:

Let the primary framework shape the architecture directly.

Examples:

- Next.js routes own application behaviour.
- GraphQL resolvers own business logic.
- ORM models own domain rules.
- React components coordinate product workflows.

Pros:

- Very fast initial delivery.
- Low ceremony.
- Easy for framework specialists to understand.
- Few abstractions.

Cons:

- Business logic becomes coupled to delivery mechanisms.
- Reuse across interfaces becomes harder.
- Testing product rules requires framework setup.
- Data access and security rules may be scattered.

Risks:

- Framework migration becomes expensive.
- Logic duplication across UI/API paths.
- Production behaviour becomes difficult to reason about.

## Decision

Use modular hexagonal architecture as the base application structure.

The product will be organised around domain modules and application use cases.

Frameworks, databases, APIs, external systems, background jobs, and UI delivery mechanisms will be treated as adapters.

The architecture will be implemented inside a modular monorepo unless a later ADR supersedes that decision.

## Rationale

Modular hexagonal architecture best satisfies the decision drivers.

It keeps product behaviour and domain logic independent from framework and infrastructure choices.

It supports the expected need for:

- React or other user interfaces
- GraphQL or other API boundaries
- PostgreSQL or other transactional stores
- ClickHouse or other analytical stores
- external data providers
- background jobs
- testing at domain, application, adapter, and API levels
- AI-assisted development with explicit boundaries

A simple layered architecture is faster initially but provides weaker protection against logic leakage.

Microservices are inappropriate at this stage because the product needs architectural clarity before distributed operational complexity.

Framework-led architecture is too likely to create accidental coupling between product logic and delivery mechanisms.

## Consequences

Positive:

- Business rules can be tested without UI, database, or network dependencies.
- Frameworks and infrastructure remain replaceable where practical.
- External integrations are isolated behind adapters.
- Product capabilities can be delivered as vertical slices.
- Security and access-control rules can be located in predictable boundaries.
- Domain language becomes more explicit.
- AI-generated code can be reviewed against clear dependency rules.

Negative:

- More initial structure is required.
- Engineers need to understand the architectural boundaries.
- Some features may require additional interface and adapter code.
- Poor discipline could create unnecessary abstraction.

Neutral / operational:

- Code review must enforce dependency direction.
- Module boundaries should be documented.
- Testing strategy must match the architecture.
- Tooling should help enforce imports and package boundaries.
- Later ADRs should define monorepo structure, API boundary, data ownership, testing approach, and specialised vocabulary.
- Architecture language must remain consistent across later ADRs.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, trade-off comparison, and consistency review.

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

- Architecture reasoning based on separation of concerns.
- Comparison against layered architecture, microservices, and framework-led architecture.
- Alignment with the ADR README and template.
- Expected product needs across UI, API, domain, data, integrations, testing, and operations.

Further validation required:

- Implement one vertical slice using the proposed boundaries.
- Confirm that domain logic can be tested without infrastructure.
- Confirm that GraphQL/API code only calls application use cases.
- Confirm that database and external integrations are replaceable adapters.
- Confirm that the structure is not creating excessive boilerplate.

## Impacted areas

- Architecture:
  - Defines the base structure and dependency direction.

- Data:
  - Data stores become adapters, not owners of business behaviour.

- API:
  - API resolvers/controllers call application use cases rather than owning domain logic.

- Security:
  - Access-control rules should sit in application/domain boundaries where possible.

- Operations:
  - Integrations and background processing should have clear adapter boundaries.

- Testing:
  - Domain, application, adapter, API, and end-to-end tests should be separated.

- Delivery:
  - Features should be delivered as vertical slices through the architecture.

- UX:
  - UI should consume product capability through stable API/application boundaries.

- Documentation:
  - Module boundaries and dependency rules need to be documented.

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

- Hexagonal architecture / ports and adapters:
  - Alistair Cockburn, Hexagonal Architecture.
  - <https://alistair.cockburn.us/hexagonal-architecture/>

- Architecture decision process:
  - docs/adr/README.md
  - docs/adr/0000-template.md

- Related ADRs:
  - docs/adr/0002-model-the-platform-around-bounded-contexts.md
  - docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
  - docs/adr/0004-define-package-lifecycle-classes.md

- Architecture vocabulary references:
  - Domain-Driven Design / bounded-context language.
  - Backstage catalog language for owner, domain, system, component, lifecycle, API, and dependency relationships.
  - C4 language for software system, container, component, and code views.
  - package.json package metadata language.
  - Nx project tag and dependency-boundary language.
  - OpenTelemetry semantic convention language for runtime and observability terms.
  - JSON Schema language for validation.
  - Kubernetes recommended labels and SPDX vocabulary where deployment or supply-chain concepts become relevant.

- Related future ADRs:
  - API boundary.
  - Data ownership.
  - Testing boundaries.
  - Import-boundary enforcement.

## Notes

This ADR does not decide the specific folder layout, package manager, build tool, API technology, database technology, or deployment topology.

Those decisions should be recorded separately.

This ADR decides the dependency direction and architectural style.
