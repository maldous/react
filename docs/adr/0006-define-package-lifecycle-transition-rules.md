# ADR-0006: Define package lifecycle transition rules

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

The architecture uses modular hexagonal boundaries and deliberate, consistent architecture vocabulary.

Bounded contexts are the primary product/domain boundary and define the domain vocabulary layer.

The repository model is a modular monorepo with promotion-ready package boundaries and a defined package/repository vocabulary layer.

Package lifecycle classes use:

```text
<stage>.<role>
```

Package metadata vocabulary and format use `package.json` as the source of truth.

The lifecycle stages are:

```text
experimental
candidate
active
stable
maintenance
external
deprecated
```

The package roles are:

```text
feature
platform
contract
adapter
tooling
test
```

The package metadata model records lifecycle information under:

```text
architecture.lifecycle.stage
architecture.lifecycle.role
architecture.lifecycle.class
architecture.lifecycle.catalogLifecycle
architecture.lifecycle.visibility
architecture.lifecycle.supportLevel
architecture.lifecycle.reviewCadence
```

This decision defines how packages move between lifecycle stages and how those lifecycle transitions are governed.

This ADR is intended to define the full package lifecycle governance model once.

Normal package transitions should be governed events, not new architecture decisions.

Without complete transition rules, lifecycle metadata will become a label instead of a governance control.

That creates predictable problems:

- packages may be promoted without evidence
- unstable packages may become dependencies too early
- stable contracts may change without compatibility review
- deprecated packages may stay in use indefinitely
- unowned packages may remain hidden
- externalisation or polyrepo extraction may happen without readiness checks
- package metadata may not match package behaviour
- CI and import-boundary rules may be applied inconsistently

The platform needs lifecycle transitions that are explicit, reviewable, evidence-based, and compatible with ADR-0005 package metadata.

## Stakeholder concerns

- Product:
  - Product work should move quickly while still allowing stable capabilities to become dependable.
  - Package promotion should not create unnecessary ceremony for early discovery.
  - Package retirement should not disrupt planned delivery.

- Engineering:
  - Engineers need clear rules for when packages can be promoted, stabilised, externalised, deprecated, or removed.
  - Lifecycle changes should be reflected in `package.json` metadata.
  - Lifecycle transitions should support affected CI and import-boundary enforcement.

- Security:
  - Security-sensitive packages need stricter transition checks before broad reuse or externalisation.
  - Deprecated or unowned packages should not hide support or vulnerability risks.

- Operations:
  - Operationally important packages need visible support level, review cadence, and owner accountability.
  - Maintenance and deprecated packages need periodic review.

- Data:
  - Contract, migration, generated-type, and data-access packages need stricter transition controls.
  - Data-impacting packages should not move to stable or external without compatibility review.

- Users/customers:
  - Stable package changes should not cause unexpected product regressions.
  - Deprecation and replacement should be planned.

- Compliance/governance:
  - Material lifecycle transitions should be auditable.
  - Transition evidence should be traceable to ADRs, pull requests, tests, and release notes.

- Support:
  - Support teams need to know whether packages are experimental, production-supported, stable, maintenance-only, external, or deprecated.

## Decision drivers

- Preserve fast early discovery.
- Make package lifecycle transitions deliberate.
- Keep transition evidence proportional to risk.
- Align transitions with ADR-0004 lifecycle stages.
- Align transition metadata with ADR-0005 `package.json` architecture metadata.
- Avoid promoting packages without owner accountability.
- Avoid leaving unowned packages in active use.
- Support future package promotion criteria.
- Support future affected-package CI.
- Support future import-boundary enforcement.
- Support future generated package README and catalog projections.
- Support externalisation and polyrepo extraction without premature distribution.
- Avoid creating new ADRs for routine package lifecycle transitions already covered by this governance model.
- Require new ADRs only when the lifecycle governance model itself changes.

## Options considered

### Option A: Allow lifecycle changes by normal code review only

Description:

Lifecycle fields in `package.json` can be changed through normal pull request review without defined transition rules.

Pros:

- Low process overhead.
- Easy to apply immediately.
- No extra governance model.

Cons:

- Review expectations are inconsistent.
- Promotion and deprecation evidence may be weak.
- Stable and external packages may not receive stronger checks.
- CI and import-boundary tooling cannot rely on consistent transition meaning.

Risks:

- Lifecycle metadata becomes subjective.
- Packages are over-promoted or under-reviewed.
- Deprecated packages remain in use.

### Option B: Require a full ADR for every lifecycle transition

Description:

Every package lifecycle transition requires its own ADR.

Pros:

- Strong audit trail.
- Clear decision ownership.
- Strong governance.

Cons:

- Duplicates the purpose of this lifecycle governance ADR.
- Too heavy for normal package evolution.
- Slows early discovery.
- Creates excessive ADR volume.
- Encourages teams to avoid updating lifecycle metadata.
- Turns routine package-state changes into architecture-history noise.

Risks:

- ADR process becomes noisy.
- Architecture history is filled with package-level state changes.
- Lifecycle metadata becomes stale because transitions feel too expensive.

### Option C: Define a complete lifecycle governance model with gated transition evidence

Description:

Use standard transition paths and require evidence proportional to the target stage and package role.

This ADR defines the full lifecycle governance model.

Package transitions that comply with this ADR do not require new ADRs.

They require package metadata changes, generated documentation updates, validation gates, evidence bundles, and required approvals.

A new ADR is required only when the lifecycle governance model itself changes.

Pros:

- Balances speed and governance.
- Makes transition meaning consistent.
- Supports automation and AI-assisted review.
- Keeps evidence proportional to risk.
- Aligns with ADR-0004 and ADR-0005.
- Avoids ADR overload while preserving material architecture history.
- Makes lifecycle transition enforcement toolable.

Cons:

- Requires transition documentation.
- Requires validation tooling later.
- Requires clear exception handling.
- Needs owner discipline.

Risks:

- Transition gates may be bypassed unless CI and review rules enforce them.
- Early rules may need refinement after vertical slices.

### Option D: Freeze lifecycle stage at package creation

Description:

A package lifecycle stage is selected when created and rarely changed.

Pros:

- Simple to understand.
- Avoids promotion churn.
- Easy to validate.

Cons:

- Does not reflect package maturity over time.
- Blocks useful promotion from experimental to active/stable.
- Does not support deprecation or externalisation well.
- Weak fit for promotion-ready monorepo strategy.

Risks:

- Metadata becomes inaccurate.
- Package maturity is not visible.

## Decision

Use a complete lifecycle governance model with standard transition gates and proportional evidence.

This ADR governs normal package lifecycle transitions.

A package transition does not require a new ADR when it follows this ADR, passes the required gates, updates metadata, regenerates documentation, and records evidence.

Package lifecycle transitions must be recorded by updating `package.json` architecture metadata.

The canonical lifecycle stage remains:

```text
architecture.lifecycle.stage
```

The canonical package role remains:

```text
architecture.lifecycle.role
```

The canonical lifecycle class remains:

```text
architecture.lifecycle.class
```

The lifecycle class must always equal:

```text
architecture.lifecycle.stage + "." + architecture.lifecycle.role
```

Lifecycle stage transitions use this primary flow:

```text
experimental
  ?
candidate
  ?
active
  ?
stable
  ?
maintenance
  ?
deprecated
```

Externalisation is a promotion path from a sufficiently mature package:

```text
stable
  ?
external
```

A package may also move from active to deprecated when the package is being retired before stabilisation:

```text
active
  ?
deprecated
```

A package may move from candidate back to experimental if validation fails:

```text
candidate
  ?
experimental
```

A package may move from stable back to active only when active product change resumes and compatibility expectations are explicitly reviewed:

```text
stable
  ?
active
```

The `unowned` state is not a lifecycle stage.

It is an exception state.

Unowned packages must be handled by one of these outcomes:

```text
reassign owner
archive
delete
deprecate
```

Unowned packages must not be promoted.

Unowned packages must not be used for new work.

## Transition rules

### Create as experimental

A new package should start as:

```text
experimental.<role>
```

unless there is explicit evidence that it is already production-supported.

Requirements:

```text
package.json architecture metadata exists
domain or shared area is identified
owner is assigned
README can be generated from metadata
package purpose is clear
```

### experimental to candidate

Use when a package is being assessed for broader use or production use.

Requirements:

```text
owner confirmed
domain or shared area confirmed
public exports identified
initial tests exist
known consumers identified
runtime.testOnly classification correct
deep import policy declared
```

Evidence:

```text
pull request
package metadata diff
test output or validation note
```

Review:

```text
package owner review
engineering review
```

### candidate to active

Use when a package becomes production-supported or live-product supporting.

Requirements:

```text
production runtime classification confirmed
owner confirmed
domain values match context map/glossary
package role confirmed
public exports enforced or documented
tests cover supported behaviour
known consumers documented
support level set to standard or enhanced
review cadence set
```

Evidence:

```text
pull request
test output
first vertical slice evidence or production usage evidence
generated README output
```

Review:

```text
package owner review
engineering review
security review when security-sensitive
data review when data-impacting
operations review when operationally critical
```

### active to stable

Use when the package has a mature contract and should receive stronger compatibility expectations.

Requirements:

```text
stable public exports
known consumers documented
breaking-change policy documented
semverPolicy is compatibility-reviewed or semver-required
support level is standard or enhanced
regression tests exist
compatibility review completed
deprecation path for future breaking changes documented
```

Evidence:

```text
pull request
test output
consumer impact review
compatibility review
generated README output
```

Review:

```text
package owner review
architecture review
affected consumer review
security/data/operations review when applicable
```

### stable to maintenance

Use when a package remains supported but is rarely changed.

Requirements:

```text
owner confirmed
supportLevel is maintenance
reviewCadence set
known consumers documented
replacement or continuation rationale documented
compatibility expectations retained
```

Evidence:

```text
pull request
maintenance rationale
consumer list
generated README output
```

Review:

```text
package owner review
architecture review
operations review when operationally important
```

### stable to external

Use when a package is consumed as a separately versioned dependency, external distribution, or separate repository.

Requirements:

```text
stable lifecycle stage before transition
visibility is external
semverPolicy is semver-required or external-governed
public exports are stable
deep imports are not allowed
changelog discipline exists
release process exists
owner and support model confirmed
security and supply-chain implications reviewed
consumer compatibility reviewed
promotion rationale documented
```

Evidence:

```text
ADR or action-register item linked to a recorded architecture decision
release plan
versioning plan
consumer impact review
security/supply-chain review when applicable
generated README output
```

Review:

```text
architecture review
package owner review
security review
operations review
affected consumer review
release review
```

### active or stable to deprecated

Use when a package should not be used for new work.

Requirements:

```text
replacement guidance documented
known consumers identified
migration path documented
target removal review date set
supportLevel is deprecated
semverPolicy is deprecated
changeControl is deprecation-review
promotionEligible is false
new usage blocked where practical
generated README explains deprecation
```

Evidence:

```text
pull request
consumer list
migration plan
generated README output
```

Review:

```text
package owner review
affected consumer review
architecture review for shared packages
operations review when operationally important
```

### deprecated to removed or archived

Use when no supported usage remains or the package is no longer required.

Requirements:

```text
known consumers removed or migrated
replacement available where required
release notes or migration record completed when user/customer impact exists
package removed from workspace or archived
metadata inventory updated
```

Evidence:

```text
pull request
consumer scan
test output
migration evidence
```

Review:

```text
package owner review
engineering review
operations review when applicable
```

## Role-specific transition constraints

### contract packages

`contract` packages require stronger compatibility review before becoming active, stable, or external.

Examples:

```text
GraphQL schema
generated API types
event contracts
SDK types
public API clients
```

Additional requirements:

```text
consumer impact review
breaking-change policy
compatibility tests where practical
semverPolicy compatibility-reviewed or stronger before stable
```

### adapter packages

`adapter` packages require integration-boundary review before becoming active or stable.

Examples:

```text
database adapter
external service adapter
queue adapter
storage adapter
third-party API adapter
```

Additional requirements:

```text
integration failure behaviour documented
runtime environment expectations documented
observability expectations documented where operationally relevant
```

### platform packages

`platform` packages require cross-domain impact review before becoming active, stable, maintenance, or external.

Additional requirements:

```text
known consumer list
support expectations
owner accountability
regression testing proportional to consumer count
```

### test packages

`test` packages may become active or stable within the testing domain, but production runtime packages must not depend on test-role packages.

Additional requirements:

```text
runtime.testOnly is true unless explicitly justified
production dependency checks reject test-only imports
```

### tooling packages

`tooling` packages require delivery and CI impact review before becoming active or stable.

Additional requirements:

```text
local development impact understood
CI impact understood
failure mode documented
```

### feature packages

`feature` packages may move faster than contract, platform, or adapter packages.

Additional requirements increase only when the package becomes shared, stable, external, or cross-domain.

## Metadata changes required by transition

Every lifecycle transition must update these fields where applicable:

```text
architecture.lifecycle.stage
architecture.lifecycle.class
architecture.lifecycle.catalogLifecycle
architecture.lifecycle.visibility
architecture.lifecycle.supportLevel
architecture.lifecycle.reviewCadence
architecture.governance.semverPolicy
architecture.governance.changeControl
architecture.governance.promotionEligible
architecture.runtime.production
architecture.runtime.testOnly
architecture.boundaries.publicExportsOnly
architecture.boundaries.deepImportsAllowed
architecture.readme
```

Generated README output must be refreshed after lifecycle metadata changes.

Any generated catalog, tag, diagram, runtime, deployment, or supply-chain projection must remain derived from `package.json`.

## Catalog lifecycle projection

ADR-0005 defines this projection:

```text
experimental -> experimental
candidate -> experimental
active -> production
stable -> production
maintenance -> production
external -> production
deprecated -> deprecated
```

This projection must update automatically when `architecture.lifecycle.stage` changes.

The catalog lifecycle projection must not replace ADR-0004 lifecycle stages.

## Lifecycle evidence bundle

Each transition must produce a lifecycle evidence bundle.

The bundle may be generated by tooling, AI-assisted review, CI, or a combination of those mechanisms.

Minimum evidence bundle fields:

```text
package
fromLifecycleClass
toLifecycleClass
metadataChanged
readmeGenerated
schemaValid
ownerApproved
requiredReviewersApproved
testsPassed
consumerImpactChecked
boundaryRulesPassed
semverPolicyChecked
catalogLifecycleUpdated
exceptions
evidenceLinks
```

Example low-risk transition bundle:

```text
package: @scope/example-feature
fromLifecycleClass: experimental.feature
toLifecycleClass: candidate.feature
metadataChanged: pass
readmeGenerated: pass
schemaValid: pass
ownerApproved: pass
requiredReviewersApproved: pass
testsPassed: pass
consumerImpactChecked: pass
boundaryRulesPassed: pass
semverPolicyChecked: not-applicable
catalogLifecycleUpdated: pass
exceptions: none
```

Example high-risk transition bundle:

```text
package: @scope/public-contract
fromLifecycleClass: stable.contract
toLifecycleClass: external.contract
metadataChanged: pass
readmeGenerated: pass
schemaValid: pass
ownerApproved: pass
requiredReviewersApproved: architecture, security, operations, affected-consumers, release
testsPassed: pass
consumerImpactChecked: pass
boundaryRulesPassed: pass
semverPolicyChecked: pass
catalogLifecycleUpdated: pass
exceptions: none
evidenceLinks: compatibility review, release plan, changelog, consumer impact review
```

AI-assisted review may be used to inspect the evidence bundle.

AI review must not be the sole approval authority.

Human owners remain accountable for lifecycle transition approval.

## Transition governance and ADR materiality

This ADR is the full lifecycle governance ADR.

Package transitions are governed events, not new architecture decisions.

A package lifecycle transition does not require a new ADR when all of the following are true:

```text
the transition path is allowed by this ADR
required package.json architecture metadata is updated
generated README output is refreshed
required validation gates pass
required reviewers approve
required evidence bundle is attached to the pull request or delivery record
no exception to this ADR is required
```

A new ADR is required only when changing the lifecycle governance model itself.

Examples that require a new ADR:

```text
add a lifecycle stage
remove a lifecycle stage
rename a lifecycle stage
change allowed transition paths
change required transition evidence
change package role definitions
change lifecycle metadata representation
change catalog lifecycle projection rules
change externalisation governance
change semver policy model
change deprecation/removal policy
permit an exception to this ADR for a material package
```

Examples that do not require a new ADR when this ADR is followed:

```text
experimental to candidate for a local feature package
candidate to active for a bounded-context feature package
active to stable for a package that passes compatibility gates
stable to external for a package that passes externalisation gates
active to maintenance for a low-risk internal package
active or stable to deprecated with migration evidence
deprecated to removed after all consumers are migrated
```

Material or high-risk package transitions still require stronger evidence and review.

They do not require a new ADR unless the approved lifecycle rules need to change.

## Rationale

The selected transition model makes lifecycle metadata operational without creating excessive ADR volume.

Because this ADR defines the lifecycle governance model completely, package transitions do not create additional ADRs unless the governance model itself changes.

It supports ADR-0003 by allowing packages to mature inside the monorepo before externalisation.

It supports ADR-0004 by giving each lifecycle stage a clear transition meaning.

It supports ADR-0005 by making `package.json` metadata the source of truth for lifecycle changes and generated documentation.

It preserves fast discovery while creating stronger gates for stable, external, cross-domain, data-impacting, security-sensitive, and operationally critical packages.

Transition evidence is proportional to risk.

This is more practical than requiring an ADR for every package-level lifecycle change and safer than allowing lifecycle changes through ordinary review without defined criteria.

## Consequences

Positive:

- Lifecycle metadata becomes actionable.
- Routine package transitions are governed without creating new ADRs.
- Package promotion becomes evidence-based.
- Stable and external packages receive stronger compatibility controls.
- Deprecated packages receive migration expectations.
- Unowned packages become visible exceptions.
- README, catalog, tag, runtime, and other projections can stay consistent with package metadata.
- Future CI and import-boundary enforcement can use transition rules.

Negative:

- Lifecycle changes require more discipline.
- Some package changes will require additional review.
- Evidence bundles must be produced for lifecycle transitions.
- Teams need to maintain metadata accurately.
- Transition rules may need refinement after early vertical slices.
- More validation tooling is required to enforce the model.

Neutral / operational:

- Routine transitions can be handled through pull requests.
- New ADRs are required for lifecycle governance changes, not for compliant package transitions.
- Transition evidence should be proportional to package role, target stage, and impact.
- Package metadata validation should eventually enforce stage/class/catalog lifecycle consistency.
- The action register should track implementation of validation tooling and review cadence.
- Transition rules must remain aligned with ADR-0004 and ADR-0005.

Future consequences:

- A later ADR should define package promotion criteria and review process in more detail only where promotion governance exceeds this lifecycle transition model.
- A later ADR should define affected-package CI behaviour.
- A later ADR should define import-boundary enforcement.
- A later implementation action should enforce lifecycle transition validation.
- A later implementation action should generate package lifecycle inventory reports.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, lifecycle governance modelling, option comparison, and consistency review.

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

- ADR-0004 defines lifecycle stages and roles.
- ADR-0005 defines package metadata fields required to record lifecycle state.
- ADR-0003 requires promotion-ready package boundaries.
- The action register identifies lifecycle transition rules as the next required decision.
- Architecture reasoning shows lifecycle stages require transition gates to become enforceable.

Further validation required:

- Test transition rules against the initial package structure.
- Validate transitions during the first vertical slice.
- Create package metadata examples for each lifecycle transition.
- Confirm generated README updates correctly after lifecycle changes.
- Confirm transition rules support future affected-package CI.
- Confirm transition rules support future import-boundary enforcement.
- Confirm transition evidence bundles can be generated, validated, and reviewed consistently.

## Impacted areas

- Architecture:
  - Defines how package lifecycle states change over time.

- Data:
  - Data-impacting packages may require stronger transition review.

- API:
  - Contract packages require compatibility review before stable or external transitions.

- Security:
  - Security-sensitive packages require stronger review before broad reuse or externalisation.

- Operations:
  - Maintenance, external, deprecated, and operationally critical packages require support and review cadence.

- Testing:
  - Tests must support transition evidence.
  - Test-role packages must not become production runtime dependencies.

- Delivery:
  - Lifecycle transitions affect CI depth, release readiness, package promotion, and deprecation work.

- UX:
  - Shared UI/design-system packages may need stable or maintenance transition rules as they mature.

- Documentation:
  - Generated package READMEs must reflect lifecycle transitions.
  - Transition evidence should be linked from pull requests, action-register items, or ADRs where material.

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

- Accepted ADRs:
  - docs/adr/0001-use-modular-hexagonal-architecture.md
  - docs/adr/0002-model-the-platform-around-bounded-contexts.md
  - docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
  - docs/adr/0004-define-package-lifecycle-classes.md
  - docs/adr/0005-define-package-metadata-format.md

- ADR process:
  - docs/adr/README.md
  - docs/adr/0000-template.md
  - docs/adr/ACTION-REGISTER.md

- Related future ADRs:
  - Package promotion criteria and review process.
  - Affected-package CI workflow.
  - Import-boundary enforcement.
  - Build/test orchestration tooling.

## Notes

This ADR defines lifecycle transition governance in full.

This ADR does not define package promotion criteria beyond lifecycle transition governance.

This ADR does not define CI enforcement implementation.

This ADR does not define import-boundary enforcement implementation.

This ADR does not finalise package review cadence values.

This ADR defines lifecycle transition rules and governance required to make ADR-0004 lifecycle classes and ADR-0005 package metadata operational.

Compliant package lifecycle transitions do not require new ADRs.

New ADRs are required when changing the lifecycle governance model itself.
