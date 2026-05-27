# ADR-0015: Define analytical data ownership

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

The platform emits analytical events: user interactions, workflow completions, ingestion results, and system-level operational metrics that feed reporting and product analytics.

Without a defined analytical data ownership boundary, event emission and query logic scatter across the codebase. Analytical contracts are not governed separately from transactional contracts. ClickHouse query ownership is implicit.

The package structure already includes:

```text
@platform/contracts-analytics
@platform/adapters-clickhouse
@platform/adapters-ingestion
```

This ADR formalises which package owns analytical data persistence and defines the event emission and query ownership rules.

## Stakeholder concerns

- Product:
  - Product analytics must be driven by governed event contracts, not ad-hoc queries.
  - Reporting must remain consistent when product features change.

- Engineering:
  - Analytical event contracts must be separate from transactional contracts.
  - ClickHouse query implementations must not leak into feature packages.
  - Event emission must be possible from feature packages without importing ClickHouse clients.

- Security:
  - ClickHouse credentials must not be visible outside the adapter layer.
  - Analytical data must not include personally identifiable information beyond governed fields.

- Operations:
  - ClickHouse connection management must be observable.
  - Event ingestion throughput and error rates must be visible.

- Compliance/governance:
  - Analytical event contracts must be versioned.
  - Data subject access and erasure rules apply to any PII in analytical records.

## Decision drivers

- Keep feature packages free of ClickHouse client imports.
- Keep analytical contracts separate from transactional contracts.
- Allow feature packages to emit events through a contract interface.
- Own ClickHouse query implementations in a single adapter package.
- Support observability at the adapter boundary.

## Options considered

### Option A: Analytical persistence in feature packages

Description:

Allow feature packages to emit events directly to ClickHouse using a client imported from inside the feature.

Pros:

- Feature teams own their own event emission.
- No event contract design required initially.

Cons:

- Feature packages import infrastructure dependencies.
- Analytical event shapes are not governed.
- Duplicate ClickHouse connection management across packages.

Risks:

- PII leaks into analytical records without a governed contract boundary.
- Schema changes require touching every feature package.

### Option B: Analytical contracts with a shared adapter package

Description:

Define event contracts in `@platform/contracts-analytics`. Own ClickHouse persistence in `@platform/adapters-clickhouse`. Feature packages emit events through the contract interface.

Pros:

- Feature packages remain infrastructure-free.
- Event shapes are governed by version-controlled contracts.
- ClickHouse implementation is replaceable without touching feature packages.
- PII control is centralised at the contract and adapter boundary.

Cons:

- Contract package requires design and governance.
- Feature packages must reference event types from the contract package.

Risks:

- Event contract evolution requires backward-compatible governance.
- Contract package growth must be governed to prevent scope creep.

### Option C: Separate event bus with push-based ingestion

Description:

Feature packages emit events to a message queue. A dedicated ingestion service consumes and stores them in ClickHouse.

Pros:

- Feature packages are fully decoupled from storage.
- Ingestion can be scaled independently.

Cons:

- Requires message queue infrastructure from day one.
- More complex initial setup.
- Event ordering and delivery guarantees require additional governance.

Risks:

- Message queue introduces new infrastructure dependencies before the platform is validated.

## Decision

`@platform/adapters-clickhouse` owns analytical data persistence.

Analytical data is:

```text
analytical events
external ingestion event history
high-volume reporting data
```

`@platform/contracts-analytics` owns analytical event contracts.

Feature packages may emit events by depending on `@platform/contracts-analytics` event types. Feature packages must not import `@platform/adapters-clickhouse` directly.

`@platform/adapters-clickhouse` may import:

```text
@platform/contracts-analytics
@platform/contracts-ingestion
```

`@platform/adapters-clickhouse` must not be imported by:

```text
domain packages
contract packages
feature packages
UI packages
operations interface packages
```

`@platform/adapters-ingestion` owns the external ingestion runtime. It depends on `@platform/contracts-ingestion` and may persist to ClickHouse through `@platform/adapters-clickhouse`.

Event emission from feature packages goes through `@platform/contracts-analytics` event types, not through direct ClickHouse client calls.

## Rationale

Centralising analytical persistence in `@platform/adapters-clickhouse` keeps feature packages infrastructure-free.

Separating `@platform/contracts-analytics` from `@platform/contracts-graphql` and transactional packages gives analytical event contracts an independent governance lifecycle.

Feature packages can emit governed events without knowing the storage backend. The storage backend can change without touching feature packages.

This separation aligns with the hexagonal architecture (ADR-0001) and bounded-context ownership (ADR-0002).

## Consequences

Positive:

- Feature packages remain infrastructure-free.
- Analytical event shapes are governed by contracts.
- ClickHouse implementation is replaceable.
- PII control is centralised at the contract and adapter boundary.

Negative:

- Analytical event contracts require upfront design.
- Feature packages must import event types from `@platform/contracts-analytics`.

Neutral / operational:

- ClickHouse connection management owned by the adapter.
- Ingestion adapter (`@platform/adapters-ingestion`) may interact with ClickHouse through the adapter.
- External ingestion contracts remain in `@platform/contracts-ingestion`, separate from `@platform/contracts-analytics`.

Future consequences:

- Design analytical event contract schema during first vertical slice.
- Govern event contract versioning and backward-compatibility policy.
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
  - ADR-0001 through ADR-0014.
  - ACTION-REGISTER.md.

- Validation required:
  - Validate against first vertical slice implementation.
  - Confirm event emission pattern in feature packages.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- `@platform/adapters-clickhouse` package exists with adapter role metadata.
- `@platform/contracts-analytics` package exists with contract role metadata.
- `@platform/adapters-ingestion` package exists with adapter role metadata.
- `@platform/contracts-ingestion` package exists with contract role metadata.
- Import boundary rules document the adapter/contract separation.

Further validation required:

- Implement analytical event contracts.
- Confirm event emission pattern during first vertical slice.
- Validate import rules against first vertical slice.

## Impacted areas

- Architecture:
  - Defines analytical data ownership boundary.

- Data:
  - ClickHouse is the analytical data store.
  - Analytical event contracts are owned by `@platform/contracts-analytics`.

- Security:
  - ClickHouse credentials visible only inside the adapter package.
  - PII governance enforced at the contract and adapter boundary.

- Operations:
  - ClickHouse connection management and health owned by the adapter.

- Analytics:
  - Analytical event emission goes through governed contracts, not direct client calls.

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
  - ADR-ACT-0006: Create the analytical data ownership ADR.

## Notes

This ADR defines analytical data ownership.

This ADR does not define transactional data ownership (see ADR-0014).

This ADR does not define the ClickHouse schema or table design.

This ADR does not define event versioning strategy or backward-compatibility rules.

This ADR does not define data retention, deletion, or compliance policies.
