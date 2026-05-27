# ADR-0010: Define lifecycle transition evidence bundle format

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

Package lifecycle classes are defined.

Package architecture metadata is recorded in package-local `package.json`.

Lifecycle transition rules are defined as governed events.

Package metadata validation tooling exists.

Generated package README structure is defined.

Generated package inventory and lifecycle report structure is defined.

The next design decision is the standard evidence bundle format for lifecycle transitions.

Lifecycle transitions include changes such as:

```text
experimental.feature -> candidate.feature
candidate.feature -> active.feature
active.feature -> stable.feature
stable.feature -> maintenance.feature
maintenance.feature -> deprecated.feature
active.tooling -> stable.tooling
active.contract -> external.contract
```

The exact allowed transition rules remain governed by ADR-0006.

This ADR defines the evidence bundle that records why a transition is requested, what was checked, who reviewed it, what reports support it, and what exceptions exist.

The evidence bundle must support package lifecycle governance without changing lifecycle rules.

The evidence bundle is committed governance evidence.

It may reference generated reports, validation output, generated package READMEs, and lifecycle summaries.

It must not be treated as a generated report.

It must not become a new source of truth for package metadata.

The package `package.json` remains the source of truth for current package architecture metadata.

Accepted ADRs remain the source of truth for architecture decisions.

## Stakeholder concerns

- Product:
  - Package maturity changes should be explainable.
  - Promotion and deprecation decisions should support delivery planning.

- Engineering:
  - Engineers need a consistent checklist for lifecycle transitions.
  - Package promotion should not depend on undocumented judgement.
  - Evidence should reference generated README, validation, and inventory outputs.

- Security:
  - Transitions involving external, stable, contract, runtime, or deprecated packages may require security review.
  - Exceptions should be visible and explicitly accepted.

- Operations:
  - Runtime impact, service ownership, support level, review cadence, and deployment environments should be visible.
  - Rollback and release-impact notes should be captured.

- Compliance/governance:
  - Evidence should link back to package metadata and accepted ADRs.
  - Evidence should identify reviewer and approval status.
  - Evidence should not replace package metadata.

- Support:
  - Support teams should see ownership, support level, operational notes, and deprecation impact.

## Decision drivers

- Comply with ADR-0001 modular hexagonal boundaries.
- Comply with ADR-0002 bounded-context ownership.
- Comply with ADR-0003 package boundary governance.
- Comply with ADR-0004 lifecycle class vocabulary.
- Comply with ADR-0005 package metadata source-of-truth rules.
- Comply with ADR-0006 lifecycle transition governance.
- Comply with ADR-0007 repository layout and root-level reports.
- Comply with ADR-0008 generated package README structure.
- Comply with ADR-0009 package inventory and lifecycle report structure.
- Keep lifecycle transition evidence reproducible and reviewable.
- Avoid creating new ADRs for routine transitions already covered by ADR-0006.
- Avoid CI workflow decisions in this ADR.
- Avoid implementation tooling decisions in this ADR.

## Options considered

### Option A: Record lifecycle transitions only in pull requests

Description:

Use pull request descriptions, comments, and approvals as lifecycle transition evidence.

Pros:

- Low process overhead.
- Fits existing code review flow.
- Easy for engineers.

Cons:

- Evidence is scattered.
- Hard to query later.
- Hard to validate.
- Does not create a consistent package lifecycle record.

Risks:

- Package lifecycle decisions become hard to audit.
- Reviewers miss required checks.

### Option B: Record lifecycle transitions only in package metadata

Description:

Store all transition evidence inside the package-local `package.json`.

Pros:

- Keeps package metadata in one file.
- Easy for validators to inspect.
- Close to the source metadata.

Cons:

- Bloats package metadata.
- Mixes current state with transition history.
- Makes `package.json` noisy and difficult to review.
- Weak fit for generated reports and approval evidence.

Risks:

- Package metadata becomes a log file.
- Historical evidence and current package state become confused.

### Option C: Create one evidence bundle per lifecycle transition under governance evidence

Description:

Create a structured evidence bundle under `docs/evidence/lifecycle/` for each lifecycle transition.

Pros:

- Keeps current package metadata separate from transition evidence.
- Supports review, audit, and validation.
- Keeps committed governance evidence separate from generated reports.
- Supports generated README and inventory report references.
- Allows both JSON and Markdown evidence surfaces.

Cons:

- Requires evidence generation or authoring tooling.
- Adds files per transition.
- Needs naming conventions and retention policy.

Risks:

- Evidence bundles may be missed unless tooling or review process enforces them.
- Evidence paths may become long for scoped package names.

## Decision

Use one evidence bundle per lifecycle transition.

This ADR extends the artifact layout with a committed governance evidence path:

```text
docs/evidence/lifecycle/
```

This path is for reviewed lifecycle transition evidence, not generated reports.

Canonical evidence bundle path:

```text
docs/evidence/lifecycle/
  <package-slug>/
    <timestamp>-<from-class>-to-<to-class>/
      transition-evidence.json
      transition-evidence.md
```

Path rules:

```text
<package-slug>
  Derived from package name.
  Scoped package names replace "/" with "__".
  Characters outside [a-zA-Z0-9._-] are replaced with "-".

<timestamp>
  UTC timestamp in YYYYMMDDTHHMMSSZ format.

<from-class>
  Existing lifecycle class before transition.

<to-class>
  Requested lifecycle class after transition.
```

Example:

```text
docs/evidence/lifecycle/
  @platform__identity/
    20260601T013000Z-active.platform-to-stable.platform/
      transition-evidence.json
      transition-evidence.md
```

Reports and evidence are different artifact classes.

Generated reports live under:

```text
reports/
```

Lifecycle transition evidence lives under:

```text
docs/evidence/lifecycle/
```

Generated reports may be regenerated and may be excluded from source control depending on repository policy.

Lifecycle transition evidence should be retained in the repository because it records an approved governance event.

The evidence bundle is committed governance evidence. It may be produced with tooling, but it is reviewed and retained as an architecture governance artifact.

The evidence bundle must not be treated as the source of truth for current package metadata.

The package-local `package.json` remains the source of truth for current package state.

The evidence bundle records transition justification, supporting report references, review state, approvals, and exceptions.

## JSON evidence structure

`transition-evidence.json` must include:

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-06-01T01:30:00Z",
  "package": {
    "name": "@platform/identity",
    "path": "packages/platform/identity",
    "version": "1.2.3"
  },
  "transition": {
    "fromLifecycleClass": "active.platform",
    "toLifecycleClass": "stable.platform",
    "fromStage": "active",
    "toStage": "stable",
    "fromRole": "platform",
    "toRole": "platform",
    "reason": "Package has stable consumers and compatibility expectations are documented.",
    "requestedBy": "person-or-role",
    "requestedAt": "2026-06-01T01:00:00Z"
  },
  "governance": {
    "decisionRefs": ["ADR-0004", "ADR-0005", "ADR-0006", "ADR-0008", "ADR-0009", "ADR-0010"],
    "changeControl": "architecture-review",
    "semverPolicy": "compatibility-reviewed",
    "promotionEligible": true
  },
  "evidence": {
    "metadataValidationReport": "reports/validation/package-metadata-validation.json",
    "generatedReadmePath": "packages/platform/identity/README.md",
    "inventoryReportPath": "reports/package-inventory/package-inventory.json",
    "lifecycleReportPath": "reports/lifecycle/package-lifecycle-summary.json",
    "testEvidence": [],
    "releaseEvidence": [],
    "securityEvidence": [],
    "operationalEvidence": []
  },
  "checks": {
    "schemaValid": true,
    "readmeGenerated": true,
    "inventoryUpdated": true,
    "consumerImpactChecked": true,
    "boundaryRulesPassed": true,
    "runtimeImpactChecked": true,
    "securityReviewRequired": false,
    "securityReviewCompleted": false,
    "releaseImpactChecked": true,
    "rollbackNotesProvided": true
  },
  "review": {
    "reviewedBy": ["person-or-role"],
    "approvedBy": ["person-or-role"],
    "approvedAt": "2026-06-01T01:30:00Z",
    "status": "approved"
  },
  "exceptions": []
}
```

Required top-level fields:

```text
schemaVersion
generatedAt
package
transition
governance
evidence
checks
review
exceptions
```

Required transition fields:

```text
fromLifecycleClass
toLifecycleClass
fromStage
toStage
fromRole
toRole
reason
requestedBy
requestedAt
```

Required checks:

```text
schemaValid
readmeGenerated
inventoryUpdated
consumerImpactChecked
boundaryRulesPassed
runtimeImpactChecked
securityReviewRequired
securityReviewCompleted
releaseImpactChecked
rollbackNotesProvided
```

Required review fields:

```text
reviewedBy
approvedBy
approvedAt
status
```

Allowed review statuses:

```text
draft
in-review
approved
rejected
superseded
```

Exception records must include:

```text
id
description
risk
acceptedBy
acceptedAt
expiresAt
followUpAction
```

If there are no exceptions, `exceptions` must be an empty array.

## Markdown evidence structure

`transition-evidence.md` must include:

```text
# Lifecycle transition evidence: <package-name>

> Generated or review-authored lifecycle transition evidence. Do not edit generated sections by hand.

## Summary

## Package

## Transition

## Governance

## Supporting evidence

## Required checks

## Review and approval

## Exceptions

## Rollback notes

## Follow-up actions
```

The Markdown summary must be readable by engineers and reviewers.

The Markdown file must reference the JSON evidence file.

The Markdown file must include a generated-file notice if generated by tooling.

## Required evidence by transition type

All transitions require:

```text
metadata validation report
generated README output
inventory report reference
lifecycle report reference
consumer impact check
boundary rules check
reviewer
approval status
rollback notes
```

Transitions to `stable.*` require:

```text
compatibility review
consumer list
semver policy review
release impact review
```

Transitions to `external.*` require:

```text
architecture review
security review
support model review
consumer contract review
release and rollback plan
```

Transitions to `deprecated.*` require:

```text
replacement or removal plan
consumer migration notes
deprecation communication notes
target removal or review date
support level confirmation
```

Transitions involving `*.contract` require:

```text
API compatibility review
consumer impact review
versioning review
```

Transitions involving `*.adapter` require:

```text
upstream/downstream dependency review
runtime impact review when applicable
```

Transitions involving `*.test` require:

```text
test-only status confirmation
production runtime exclusion confirmation
```

Transitions involving runtime packages require:

```text
deployment environment review
operational notes review
rollback notes
```

## Approval rules

Routine lifecycle transitions covered by ADR-0006 do not require a new ADR.

A new ADR is required only when the lifecycle governance model changes.

The evidence bundle must be reviewed by the package owner or architecture owner.

Security review is required when:

```text
toLifecycleClass starts with external.
toLifecycleClass starts with stable. and package has runtime production impact
toLifecycleClass includes contract and external consumers exist
transition deprecates a security-sensitive package
exceptions accept security or compliance risk
```

Operations review is required when:

```text
runtime.production is true
deploymentEnvironments includes production
supportLevel changes
rollback notes affect deployed services
```

The approved evidence bundle records the review decision.

The package metadata change remains the source of truth for the current lifecycle state.

## Rationale

ADR-0006 defines lifecycle transitions as governed events.

A governed event needs evidence that is structured enough to validate and readable enough to review.

The evidence bundle keeps current package metadata separate from transition evidence.

The JSON file supports automation and validation.

The Markdown file supports human review.

The `docs/evidence/lifecycle/` path separates committed governance evidence from generated operational reports.

Referencing validation, README, inventory, and lifecycle reports complies with ADR-0005, ADR-0008, and ADR-0009 without duplicating those outputs.

The evidence bundle allows routine lifecycle transitions to be governed without creating a new ADR every time.

## Consequences

Positive:

- Lifecycle transition evidence becomes consistent.
- Reviewers get a standard checklist.
- Package metadata remains current-state source of truth.
- Evidence can be validated.
- Evidence can support package promotion, deprecation, and externalisation.
- Routine transitions do not create unnecessary ADRs.

Negative:

- Transition evidence adds files.
- Tooling is needed for reliable generation and validation.
- Reviewers must understand the evidence bundle.
- Evidence quality still depends on metadata and report quality.

Neutral / operational:

- Evidence bundles are committed governance artifacts. They may be produced with tooling, but they are reviewed and retained.
- Evidence bundles live under `docs/evidence/lifecycle/`.
- Evidence bundles do not replace package metadata.
- Evidence bundles do not replace accepted ADRs.
- CI integration is not required by this ADR.
- Evidence generation tooling is not implemented by this ADR.

Future consequences:

- Implement lifecycle evidence generator or validator after this ADR is accepted.
- Add JSON Schema for lifecycle transition evidence if required.
- Integrate evidence checks with package lifecycle transition workflow after design is accepted.
- Validate evidence bundles against representative package roles and transition types.
- Use evidence bundles in package promotion review.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, evidence format design, transition review design, and consistency validation against ADR-0001 through ADR-0009.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - ADR-0001 modular hexagonal architecture.
  - ADR-0002 bounded contexts.
  - ADR-0003 modular monorepo package boundaries.
  - ADR-0004 lifecycle classes.
  - ADR-0005 package metadata source of truth.
  - ADR-0006 lifecycle transition governance.
  - ADR-0007 architecture artifact and repository layout.
  - ADR-0008 generated package README structure.
  - ADR-0009 package inventory and report structure.
  - Current validation tooling and reports.

- Validation required:
  - Validate against representative lifecycle transitions.
  - Validate against generated README and inventory report outputs.
  - Validate review and approval rules with engineering, security, and operations reviewers.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- ADR-0006 requires lifecycle transition governance.
- ADR-0005 defines package metadata source of truth.
- ADR-0008 defines generated README structure.
- ADR-0009 defines package inventory and lifecycle reports.
- ADR-0007 defines root-level reports for generated operational artifacts and `docs/evidence/` for committed governance evidence. This ADR uses `docs/evidence/lifecycle/` because lifecycle transition evidence is retained governance material.
- Package metadata validation tooling exists.

Further validation required:

- Confirm `docs/evidence/` taxonomy remains sufficient for governance evidence.
- Create representative evidence bundle examples.
- Validate stable, external, deprecated, contract, adapter, tooling, and test transitions.
- Confirm approval rules match operational expectations.
- Confirm evidence bundle paths are usable for scoped packages.
- Confirm reports remain generated outputs and not sources of truth.

## Impacted areas

- Architecture:
  - Defines lifecycle transition evidence structure.

- Data:
  - Packages with data ownership changes require explicit transition evidence.

- API:
  - Contract package transitions require compatibility and consumer impact evidence.

- Security:
  - External, stable runtime, contract, deprecated, and exception-bearing transitions may require security review.

- Operations:
  - Runtime packages require operational impact and rollback evidence.

- Testing:
  - Evidence bundles reference validation outputs and test evidence where applicable.

- Delivery:
  - Package promotion and deprecation become reviewable with consistent evidence.

- UX:
  - React app and UI package lifecycle transitions use the same evidence structure.

- Documentation:
  - Evidence Markdown provides reviewer-readable transition history without replacing package metadata.

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
  - docs/adr/0006-define-package-lifecycle-transition-rules.md
  - docs/adr/0007-define-architecture-artifact-and-repository-directory-layout.md
  - docs/adr/0008-define-generated-package-readme-structure.md
  - docs/adr/0009-define-package-inventory-and-report-structure.md

- Schema and tooling:
  - docs/schemas/package-json-architecture.schema.json
  - tools/architecture/validate-package-metadata/
  - reports/validation/package-metadata-validation.md

- Related future work:
  - Lifecycle transition evidence schema.
  - Lifecycle transition evidence generator.
  - Lifecycle transition evidence validator.
  - Package README generator.
  - Package inventory report generator.

## Notes

This ADR defines lifecycle transition evidence bundle format.

This ADR does not change lifecycle transition rules.

This ADR does not change package metadata source of truth.

This ADR does not implement evidence tooling.

This ADR does not require CI integration.

This ADR does not require lifecycle transition evidence to live under `reports/`.

This ADR does not require a new ADR for routine lifecycle transitions covered by ADR-0006.
