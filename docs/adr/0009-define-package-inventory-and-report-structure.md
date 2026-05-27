# ADR-0009: Define package inventory and report structure

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

Lifecycle transitions are governed events backed by metadata, evidence, validation, and review.

The repository layout uses root-level `reports/` for generated operational reports.

Generated package READMEs are package-local and metadata-backed.

The package metadata validator produces validation reports under:

```text
reports/validation/
```

The next design decision is the standard structure for package inventory and lifecycle reports.

Package inventory reports must help reviewers understand:

```text
which packages exist
which domain and bounded context each package belongs to
which lifecycle class each package has
who owns each package
which packages are production, test-only, tooling, deprecated, or external
which packages are missing required metadata
which packages are candidates for promotion, deprecation, extraction, or cleanup
```

Reports must be generated outputs.

Reports must not become sources of truth.

The source of truth remains package-local `package.json` architecture metadata and accepted ADRs.

## Stakeholder concerns

- Product:
  - Package inventory should make product/domain ownership visible.
  - Reports should help prioritise package maturity and cleanup work.

- Engineering:
  - Engineers need a quick view of packages, lifecycle classes, owners, and boundary status.
  - Reports should support package promotion and refactoring decisions.
  - Reports should not require manual editing.

- Security:
  - Reports should expose packages with external visibility, deprecated status, unknown ownership, or security-sensitive roles.

- Operations:
  - Reports should identify runtime packages, tooling packages, test-only packages, and support levels.
  - Reports should expose review cadence and operational notes where available.

- Compliance/governance:
  - Reports should trace package state back to package metadata and ADR references.
  - Generated reports should not override package metadata.

- Support:
  - Support engineers should quickly identify package owners and support level.

## Decision drivers

- Keep package-local `package.json` as source of truth.
- Keep reports generated and reproducible.
- Use root-level `reports/` from ADR-0007.
- Support package lifecycle governance from ADR-0006.
- Support generated package README structure from ADR-0008.
- Provide useful review surfaces without adding new metadata sources.
- Keep report formats simple enough for humans and automation.
- Support future dashboard or catalog generation without choosing those tools now.
- Avoid CI workflow decisions in this ADR.

## Options considered

### Option A: No standard inventory report

Description:

Use ad-hoc searches, scripts, or package manager output to inspect package state.

Pros:

- No new reporting design.
- Fast to start.
- Flexible.

Cons:

- Hard to review lifecycle state.
- Hard to identify ownership gaps.
- Hard to support promotion and cleanup.
- Inconsistent between reviewers.

Risks:

- Package metadata becomes difficult to audit.
- Lifecycle transitions rely on manual inspection.

### Option B: Maintain a manual inventory document

Description:

Create a manually maintained package inventory document.

Pros:

- Easy to read.
- Easy to annotate.
- Can be tailored for non-technical stakeholders.

Cons:

- Becomes a second source of truth.
- Drifts from package metadata.
- Requires manual updates.
- Weak fit for validation and automation.

Risks:

- Reports disagree with `package.json`.
- Reviewers trust stale information.

### Option C: Generate JSON and Markdown reports from package metadata

Description:

Generate machine-readable JSON and human-readable Markdown reports from package-local `package.json` architecture metadata.

Pros:

- Keeps `package.json` as source of truth.
- Supports automation and review.
- Produces useful human-readable output.
- Can be checked by validation tooling.
- Supports lifecycle governance and package promotion evidence.

Cons:

- Requires report generator tooling.
- Report quality depends on metadata quality.
- Markdown report may need careful grouping to stay readable.

Risks:

- Large repositories may produce long reports.
- Report consumers may treat reports as editable unless generated-file notices are clear.

## Decision

Generate package inventory and lifecycle reports from package-local `package.json` architecture metadata.

Reports are generated outputs under:

```text
reports/
  package-inventory/
    package-inventory.json
    package-inventory.md

  lifecycle/
    package-lifecycle-summary.json
    package-lifecycle-summary.md
```

The canonical report files are:

```text
reports/package-inventory/package-inventory.json
reports/package-inventory/package-inventory.md
reports/lifecycle/package-lifecycle-summary.json
reports/lifecycle/package-lifecycle-summary.md
```

The report generator must read:

```text
apps/**/package.json
packages/**/package.json
tools/architecture/**/package.json
```

The report generator may read validation output from:

```text
reports/validation/package-metadata-validation.json
```

The report generator must not use report files as input source of truth.

The package inventory JSON report must include:

```text
generatedAt
source
totalPackages
packages[]
```

Each package record must include:

```text
name
path
version
component (nested object: name, type, system, domain, boundedContext, owner)
lifecycle (nested object: stage, role, class, catalogLifecycle, visibility, supportLevel, reviewCadence)
governance (nested object: decisionRefs, semverPolicy, changeControl, promotionEligible)
runtime (nested object: production, testOnly, serviceName, serviceNamespace, deploymentEnvironments)
relations (nested object: dependsOn, providesApis, consumesApis)
tags (nested object: scope, type, stage, role, layer)
```

The lifecycle summary groups packages by:

```text
lifecycle.stage
lifecycle.role
lifecycle.class
lifecycle.supportLevel
```

The Markdown inventory report must include:

```text
# Package inventory report

Generated-file notice

## Summary

## Packages
```

The lifecycle summary JSON report must include:

```text
generatedAt
source
totalPackages
byStage (counts by lifecycle stage)
byRole (counts by lifecycle role)
byClass (counts by lifecycle class)
bySupportLevel (counts by support level)
packages[] (list of package lifecycle records)
```

The lifecycle summary Markdown report must include:

```text
# Package lifecycle summary report

Generated-file notice

## Summary

## By stage

## By role

## By class

## Packages
```

Generated reports must include a generated-file notice.

Recommended notice:

```text
> Generated from package-local package.json architecture metadata. Do not edit this report by hand.
```

Reports may be checked into source control only if repository policy requires persistent review artifacts.

If reports are checked in, they must be reproducible from the same package metadata and generator version.

Manual edits to generated reports are not allowed.

## Rationale

A generated package inventory gives reviewers a repository-wide view without creating a second source of truth.

The JSON report supports automation.

The Markdown report supports human review.

Keeping reports under root-level `reports/` follows ADR-0007 and keeps generated operational outputs separate from authored documentation.

The report fields map directly to package metadata defined by ADR-0005 and lifecycle governance defined by ADR-0006.

Including validation status makes report consumers aware of incomplete or invalid package metadata.

Separating package inventory and lifecycle summary reports keeps each report useful:

```text
package inventory
  detailed package state and ownership

lifecycle summary
  lifecycle governance and review surface
```

This ADR does not define dashboards, catalogs, CI workflows, or external publishing.

## Consequences

Positive:

- Repository package state becomes visible.
- Package lifecycle state becomes reviewable.
- Ownership gaps are easier to find.
- Validation failures are visible.
- Promotion, maintenance, deprecation, and cleanup candidates are easier to identify.
- JSON and Markdown formats support both automation and human review.

Negative:

- Report generator tooling is required.
- Reports can become large.
- Report usefulness depends on metadata quality.
- Generated reports need clear generated-file notices.

Neutral / operational:

- Reports are generated outputs.
- Reports do not replace package metadata.
- Reports should be reproducible.
- Reports should be regenerated after package metadata changes.
- CI integration is not required by this ADR.
- Dashboard or catalog publishing is not selected by this ADR.

Future consequences:

- Implement package inventory report generator after this ADR is accepted.
- Validate report output against representative app, package, tooling, and test packages.
- Use inventory output to support lifecycle transition evidence.
- Use inventory output to support package README generator review.
- Use inventory output to identify missing owners, lifecycle mismatches, and unsupported package states.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, report structure design, consistency review, and artifact validation support.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - Related ADRs.
  - Package metadata schema.
  - Package metadata validation tooling.
  - Generated README structure.
  - Repository artifact layout.
  - Stated architecture constraints.

- Validation required:
  - Validate against representative package metadata.
  - Validate report readability with engineering reviewers.
  - Validate generated reports do not become sources of truth.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- Package metadata schema exists.
- Package metadata validator exists.
- Root-level `reports/` path is defined.
- Package lifecycle stages and roles are defined.
- Package README structure is generated from metadata.
- Lifecycle transition governance needs package-wide evidence surfaces.

Further validation required:

- Implement report generator.
- Generate reports for representative package roles.
- Confirm report grouping is useful.
- Confirm validation failures are clear.
- Confirm reports remain reproducible.

## Impacted areas

- Architecture:
  - Defines generated package inventory and lifecycle report structure.

- Data:
  - Reports expose package domain, bounded context, ownership, and metadata status.

- API:
  - Contract package relationships and API declarations are visible.

- Security:
  - External, deprecated, and unsupported packages become visible.

- Operations:
  - Runtime, test-only, tooling, support level, and review cadence become visible.

- Testing:
  - Validation failures are included in report output.

- Delivery:
  - Reports support package promotion, cleanup, and lifecycle review.

- UX:
  - React app, UI, and feature packages are visible in inventory and lifecycle summaries.

- Documentation:
  - Reports remain generated operational outputs, not authored documentation.

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

- Related proposed ADR:
  - docs/adr/0008-define-generated-package-readme-structure.md

- Schema and tooling:
  - docs/schemas/package-json-architecture.schema.json
  - tools/architecture/validate-package-metadata/
  - reports/validation/package-metadata-validation.md

- Related future work:
  - Package inventory report generator.
  - Lifecycle transition evidence validation.
  - Package README generator.

## Notes

This ADR defines report structure.

This ADR does not implement the report generator.

This ADR does not require CI integration.

This ADR does not define dashboards or external catalog publishing.

This ADR does not allow reports to become independent sources of truth.

This ADR uses future generated-output wording without reserving any generated-output directories beyond the reports paths defined here.
