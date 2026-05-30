# ADR-0004: Define package lifecycle classes

## Status

Accepted

## Date

2026-05-26

## Decision owner

Architecture owner / technical lead.

## Consulted

- Product owner
- Engineering team
- Delivery lead
- Operations reviewer
- Security reviewer
- Architecture review support

## Context

The architecture uses modular hexagonal boundaries, bounded contexts, and a modular monorepo with promotion-ready package boundaries.

ADR-0003 also established that packages should be designed so they can later be promoted to separately versioned packages or extracted into polyrepos when justified.

ADR-0002 established bounded contexts, which means package classification must not only describe technical maturity. Each package also needs an explicit domain or shared-area owner.

This ADR defines lifecycle classification and requires domain metadata, but it does not define the final domain list. The allowed domain values should come from the context map and domain glossary created from ADR-0002.

Lifecycle vocabulary must align with ADR-0001's language principle.

This ADR owns the package lifecycle vocabulary layer.

The lifecycle model intentionally remains richer than common catalog lifecycle fields.

For external compatibility, ADR-0005 may define projections from `experimental`, `candidate`, `active`, `stable`, `maintenance`, `external`, and `deprecated` into simpler catalog or tooling lifecycle values.

Those projections must not replace ADR-0004's source lifecycle model.

Vocabulary clarification:

```text
lifecycle stage
  ADR-0004 source stage: experimental, candidate, active, stable, maintenance, external, deprecated

package role
  ADR-0004 source role: feature, platform, contract, adapter, tooling, test

lifecycle class
  source lifecycle identifier: <stage>.<role>

catalog lifecycle
  simplified external projection defined by ADR-0005 when needed

visibility
  package metadata exposure/promotion state defined by ADR-0005
```

ADR-0004 lifecycle stages are the source vocabulary.

ADR-0005 may define generated catalog lifecycle or visibility projections, but those projections must not replace the ADR-0004 lifecycle model.

The platform needs clear package lifecycle classes that define how packages are owned, changed, tested, versioned, supported, and promoted over time.

Without lifecycle classes, all packages risk being treated the same.

That creates predictable problems:

- stable contracts may change too casually
- fast-moving packages may be burdened with excessive release process
- shared packages may become dumping grounds
- CI may run too broadly
- versioning rules may be inconsistent
- promotion to external distribution or polyrepo may be ad hoc
- ownership and compatibility expectations may be unclear

## Stakeholder concerns

- Product:
  - Fast-moving product work should not be slowed by premature package governance.
  - Stable capabilities should become dependable building blocks.
  - Reusable packages should have clear maturity expectations.

- Engineering:
  - Engineers need to know the maturity, role, owner, and domain of each package.
  - Package boundaries should support dependency checks and affected CI.
  - Shared packages should not become unowned dumping grounds.

- Security:
  - Security-sensitive packages need stricter ownership, review, and release controls.
  - Packages promoted beyond internal use need stronger compatibility and vulnerability management.

- Operations:
  - Packages with `releaseable` or `external` visibility need clear operational expectations.
  - Build and test workflows should reflect package criticality.

- Data:
  - Data contracts and data-access packages may require stricter lifecycle controls than feature code.
  - Schema, migration, and generated-contract packages need compatibility discipline.

- Users/customers:
  - Stable product behaviour depends on stable internal contracts.
  - Reusable platform capabilities should not regress unexpectedly.

- Compliance/governance:
  - Material package lifecycle changes should be reviewable.
  - Promotion to external distribution or polyrepo should have recorded rationale.

- Support:
  - Support needs to know which packages are stable platform dependencies and which are still evolving.

## Decision drivers

- Support ADR-0001 modular hexagonal architecture.
- Support ADR-0002 bounded-context ownership.
- Support ADR-0003 promotion-ready package boundaries.
- Preserve fast iteration for early product discovery.
- Define stronger controls for stable and shared packages.
- Prepare selected packages for possible external distribution or polyrepo extraction.
- Avoid treating every package as equally stable or equally experimental.
- Support affected-package CI and dependency impact analysis.
- Make package ownership and compatibility expectations explicit.
- Keep package domain ownership separate from lifecycle maturity and package role.
- Keep lifecycle terminology externally projectable without reducing ADR-0004's richer lifecycle model.
- Require package metadata that is readable by people and parseable by tooling.

## Options considered

### Option A: Treat all packages the same

Description:

All packages follow the same change, review, versioning, and testing expectations.

Pros:

- Simple to understand.
- Low initial governance overhead.
- Easy to apply consistently.

Cons:

- Fast-moving product packages and stable shared packages have different needs.
- Stable contracts may change too easily.
- Experimental packages may be over-governed.
- Promotion readiness is unclear.

Risks:

- Shared packages become unreliable.
- CI and release policy become either too strict or too weak.
- Package maturity is invisible.

### Option B: Define only internal and external packages

Description:

Classify packages as either internal-only or externally published.

Pros:

- Simple distinction.
- Useful for publication decisions.
- Easy to connect to access and release policy.

Cons:

- Too coarse for enterprise development.
- Does not distinguish fast-moving internal packages from stable internal platform packages.
- Does not identify candidates being prepared for promotion.
- Does not guide CI depth or compatibility expectations well.

Risks:

- Internal packages may become widely reused without stable contract discipline.
- Externalisation may happen too late or without preparation.

### Option C: Define lifecycle stage and package role separately

Description:

Classify each package using a regular `<stage>.<role>` lifecycle class, while separately declaring its domain and owner.

Pros:

- Regular and parseable.
- Separates maturity from package purpose.
- Separates domain ownership from lifecycle maturity.
- Supports semver and compatibility expectations as packages mature.
- Supports future externalisation or polyrepo extraction.
- Helps affected CI and dependency analysis.

Cons:

- Requires metadata discipline.
- Requires context map and glossary to define domain values.
- Requires transition rules in a later decision.
- Requires education for teams and stakeholders.

Risks:

- Lifecycle classes may become stale if not reviewed.
- Teams may over-promote packages before contracts are stable.
- Too much governance may slow development if applied too early.

### Option D: Start with polyrepo boundaries for all stable packages

Description:

Any package expected to become stable or reusable starts in its own repository from the beginning.

Pros:

- Strong boundary enforcement.
- Clear ownership and release lifecycle.
- Stronger access control.

Cons:

- Adds multi-repo coordination before package maturity is proven.
- Slows early vertical-slice delivery.
- Requires publishing, dependency updates, and compatibility checks early.
- Creates local-development friction.

Risks:

- Premature distribution.
- Version drift.
- Slower product learning.
- Higher operational overhead.

## Decision

Define package lifecycle classes using this regular format:

```text
<stage>.<role>
```

The first part describes maturity and support stage.

The second part describes package role.

The stage must be one of:

```text
experimental
candidate
active
stable
maintenance
external
deprecated
```

The role must be one of:

```text
feature
platform
contract
adapter
tooling
test
```

This means lifecycle classes use the same grammar everywhere:

```text
experimental.<role>
candidate.<role>
active.<role>
stable.<role>
maintenance.<role>
external.<role>
deprecated.<role>
```

The stage answers:

```text
How mature and supported is this package?
```

The role answers:

```text
What kind of package is this?
```

Stage meanings:

```text
experimental
  Exploratory package.
  Used for spikes, prototypes, or unstable ideas.
  No compatibility guarantees.
  Not used by production paths.
  May be deleted unless promoted.

candidate
  Package being assessed for wider use or production use.
  Requires clear owner, public exports, tests, dependency review, and acceptance evidence.
  Breaking changes must be visible to affected consumers.

active
  Production-supported package that is still changing regularly.
  Used by live product behaviour or production workflows.
  Requires production-grade tests, release traceability, and ownership.

stable
  Production-supported package with a mature, stable contract.
  Requires compatibility review, changelog discipline, stronger regression tests, and planned deprecation path for breaking changes.

maintenance
  Supported package that is valid but rarely changed.
  Used for mature, low-change capabilities.
  Requires owner, compatibility expectations, and periodic review.

external
  Package has moved to a separately versioned distribution or separate repository.
  The monorepo consumes it through a versioned dependency or documented integration contract.

deprecated
  Package should not be used for new work.
  Existing usage remains temporarily supported.
  Requires replacement guidance, migration plan, and target removal review.
```

Role meanings:

```text
feature
  Package owned by a product capability or bounded context.
  Contains product-facing application/domain behaviour.

platform
  Shared internal platform capability used by multiple product areas.
  Examples include auth helpers, observability helpers, shared runtime utilities, or design-system packages.

contract
  Package that defines a public or cross-boundary contract.
  Examples include GraphQL schema, generated types, SDK types, event contracts, or API clients.

adapter
  Package that integrates with a database, external service, third-party API, storage system, queue, or infrastructure boundary.

tooling
  Package used for build, code generation, local development, scripts, migrations, or operational tooling.

test
  Package used for tests, fixtures, mocks, contract-test harnesses, test containers, or local-only validation support.
  Production runtime packages must not depend on test-role packages.
```

Examples:

```text
experimental.feature
candidate.platform
active.feature
stable.contract
maintenance.adapter
external.contract
deprecated.platform
```

A package with no active owner or supported runtime path is not a lifecycle class.

It is an exception state and must be handled as an ownership issue:

```text
unowned
  Not a valid target lifecycle.
  Must not be used for new work.
  Must be reassigned, archived, deleted, or formally deprecated.
```

Domain ownership and lifecycle class are separate required properties.

A package classification is incomplete without both.

A package must declare:

```text
domain: <bounded-context-or-shared-area>
lifecycleStage: <stage>
packageRole: <role>
lifecycleClass: <stage>.<role>
owner: <team-or-role>
```

The domain says what business, platform, or support area owns the package.

The lifecycle stage says how mature, stable, and supportable the package is.

The package role says what kind of package it is.

The owner says who is accountable for maintenance, review, and promotion decisions.

Allowed domain values must come from the bounded-context context map and domain glossary.

Promotion to `external.<role>` or a separate repository requires an ADR or an action-register item linked to a recorded architecture decision.

## Rationale

Package lifecycle classes make the modular monorepo posture from ADR-0003 practical.

Lifecycle class alone cannot answer ownership.

For example:

```text
active.feature
```

does not say whether the package belongs to market-data, simulation, reporting, or another bounded context.

The package domain supplies ownership and business boundary.

The lifecycle class supplies maturity and support expectations.

Backstage-compatible lifecycle values, if needed later, should be generated from ADR-0004 lifecycle stages rather than manually maintained.

The selected model separates maturity stage from package role.

This removes ambiguity between package purpose and runtime environment.

The class names are designed to be understandable to technical and non-technical stakeholders:

```text
experimental  still being shaped
candidate     being assessed for wider use
active        supported and used in live product or platform work
stable        mature contract with stronger compatibility expectations
maintenance   supported but rarely changed
external      consumed as an independently versioned dependency
deprecated    being retired
```

Semver expectations increase as packages mature:

```text
experimental.<role>  no semver expectation
candidate.<role>     breaking changes must be visible to affected consumers
active.<role>        release traceability required
stable.<role>        changelog and compatibility discipline required
maintenance.<role>   compatibility maintained, low change
external.<role>      external dependency/version governance required
deprecated.<role>    replacement/migration path required
```

Typical feature-package path:

```text
experimental.feature
  ?
candidate.feature
  ?
active.feature
  ?
stable.feature
  ?
maintenance.feature
```

Typical contract-package path:

```text
candidate.contract
  ?
active.contract
  ?
stable.contract
  ?
external.contract
```

Typical retirement path:

```text
active.<role> | stable.<role> | maintenance.<role>
  ?
deprecated.<role>
  ?
removed or archived
```

Not every package should move through every stage.

## Consequences

Positive:

- Package maturity becomes visible.
- Package ownership becomes explicit through domain and owner metadata.
- Stable packages can receive stronger compatibility and regression controls.
- Fast-moving product packages can avoid premature release overhead.
- CI can become more targeted by lifecycle class.
- Package promotion becomes deliberate.
- Future polyrepo extraction becomes easier to reason about.

Negative:

- Package metadata must be maintained.
- Lifecycle classes may become stale if not reviewed.
- Promotion review adds process overhead.
- Engineers need to understand lifecycle expectations.
- Allowed domain values depend on context map and glossary quality.

Neutral / operational:

- Package lifecycle class should influence CI depth, test expectations, review requirements, acceptance gates, and production-readiness expectations.
- Packages cannot be assessed by lifecycle class alone; domain and owner metadata are also required.
- Import-boundary enforcement should use lifecycle class metadata where practical.
- Production packages must not depend on test-role packages.
- Externalisation or polyrepo promotion candidates need explicit extraction rationale.
- Lifecycle classes should be validated against the context map and domain glossary.

Future consequences:

- ADR-0005 defines package metadata vocabulary and format.
- A later ADR should define package lifecycle transition rules.
- A later ADR should define package promotion criteria and review process.
- A later ADR should define affected-package CI workflows.
- A later ADR should define build/test orchestration tooling.
- A later ADR should define import-boundary enforcement.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, lifecycle modelling, and consistency review.

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

- ADR-0003 requires promotion-ready package boundaries.
- ADR-0002 requires domain ownership through bounded contexts.
- The action register identifies package lifecycle classes as the next required decision.
- Architecture reasoning shows packages have different maturity, stability, and release needs.
- Enterprise package governance commonly requires ownership, stability, compatibility, and release expectations to be visible.

Further validation required:

- Assign lifecycle classes and domain metadata to initial packages.
- Validate lifecycle classes during the first vertical slice.
- Confirm CI can use lifecycle class metadata.
- Confirm lifecycle classes help rather than slow delivery.
- Confirm package domain values are sourced from the context map and glossary.
- Confirm production packages cannot depend on test-role packages.
- Confirm deprecated and unowned package states are actionable.

## Impacted areas

- Architecture:
  - Defines how package maturity and promotion readiness are represented.

- Data:
  - Data contracts, generated types, migrations, and data-access packages may require stricter lifecycle classes.

- API:
  - API contract and generated-client packages may move toward stable.contract or external.contract.

- Security:
  - Security-sensitive packages may require stronger review before promotion.

- Operations:
  - Packages with `external` visibility require clearer support and release expectations.

- Testing:
  - Test depth should vary by lifecycle class and dependency impact.
  - Production packages must not depend on test-role packages.

- Delivery:
  - Fast-moving product packages can iterate quickly while stable packages receive stronger checks.

- UX:
  - Shared UI and design-token packages may evolve toward stable.platform.

- Documentation:
  - Package READMEs or metadata must record lifecycle class, domain, and ownership.
  - Package lifecycle class names must remain regular and parseable.
  - Package documentation should explain lifecycle in terms third-party stakeholders can understand.

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

- Lifecycle vocabulary references:
  - This ADR's lifecycle stages and roles as the source lifecycle vocabulary.
  - Backstage lifecycle language for future catalog projection.
  - package.json and JSON Schema language for validation and representation.

- Accepted ADRs:
  - docs/adr/0001-use-modular-hexagonal-architecture.md
  - docs/adr/0002-model-the-platform-around-bounded-contexts.md
  - docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
  - docs/adr/0005-define-package-metadata-format.md

- ADR process:
  - docs/adr/README.md
  - docs/adr/0000-template.md
  - docs/adr/ACTION-REGISTER.md

- Related future ADRs:
  - Package metadata format.
  - Package lifecycle transition rules.
  - Package promotion criteria and review process.
  - Affected-package CI workflow.
  - Build/test orchestration tooling.
  - Import-boundary enforcement.

## Notes

This ADR does not choose package metadata tooling; ADR-0005 defines the package metadata vocabulary and format.

This ADR requires package domain metadata but does not finalise the allowed domain list.

This ADR does not define the exact promotion criteria from one class to another.

This ADR does not decide the build/test orchestrator.

This ADR defines package lifecycle classes and the expectation that packages declare and maintain a regular, parseable lifecycle stage and package role.
