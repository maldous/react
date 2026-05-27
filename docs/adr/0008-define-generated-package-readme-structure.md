# ADR-0008: Define generated package README structure

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

Package architecture metadata is recorded in each package's `package.json`.

Lifecycle transition governance depends on package metadata, evidence, validation, and review.

The architecture artifact layout keeps package READMEs package-local.

The package metadata validator checks that `architecture.readme` metadata exists and is valid.

The next design decision is the structure of the package-local `README.md` generated from package metadata.

Package READMEs must help engineers understand package purpose, ownership, lifecycle, boundaries, usage, and operational expectations without reading all ADRs first.

Package READMEs must not become independent sources of truth.

The generated README must be deterministic and reproducible from package metadata.

## Stakeholder concerns

- Product:
  - Package purpose and ownership should be easy to understand.
  - Package documentation should help onboarding and support future delivery.

- Engineering:
  - Package READMEs should explain usage, public exports, package role, and boundary rules.
  - Package documentation should not require manual maintenance after every metadata change.
  - Generated output should be stable enough for review diffs.

- Security:
  - Packages with security or supply-chain relevance should expose ownership and support expectations clearly.
  - Generated README content should not hide lifecycle or support state.

- Operations:
  - Runtime packages should expose operational notes and deployment environment expectations.
  - Test-only and tooling packages should be clearly identified.

- Compliance/governance:
  - Generated README content should reference governing ADRs and package lifecycle state.
  - Generated files should be marked as generated output.

- Support:
  - Support engineers should be able to determine package owner, responsibility, non-responsibility, and support level quickly.

## Decision drivers

- Keep `package.json` architecture metadata as the package source of truth.
- Keep package README output package-local.
- Make package purpose and boundaries clear for first-time readers.
- Avoid manual README drift.
- Support lifecycle transition evidence from ADR-0006.
- Support directory layout from ADR-0007.
- Support validation tooling from ADR-ACT-0034.
- Keep output deterministic.
- Keep the template useful for React apps, UI packages, domain packages, contract packages, adapter packages, tooling packages, and test packages.
- Avoid encoding implementation choices not yet decided.

## Options considered

### Option A: Hand-author package READMEs

Description:

Each package owner writes and maintains `README.md` manually.

Pros:

- Flexible.
- Easy to start.
- Allows rich package-specific explanation.

Cons:

- Drifts from package metadata.
- Hard to validate consistently.
- Creates repeated manual documentation work.
- Weakens lifecycle transition evidence.

Risks:

- README says one thing while package metadata says another.
- Package consumers rely on stale usage or ownership information.

### Option B: Generate the entire README from package metadata

Description:

The package README is fully generated from `package.json` architecture metadata and standard repository conventions.

Pros:

- Deterministic.
- Easy to validate.
- Keeps package metadata as source of truth.
- Reduces manual maintenance.
- Supports consistent package review.

Cons:

- Package-specific nuance may be limited.
- Requires a generator.
- Requires package metadata to be complete and useful.

Risks:

- Generated documentation may feel too mechanical.
- Teams may add too much prose into metadata fields.

### Option C: Generate a standard README with optional marked extension sections

Description:

The README is generated from package metadata.

Most sections are fully generated.

A small number of explicitly marked extension sections may be preserved by the generator if future implementation requires package-specific detail.

Pros:

- Keeps metadata as source of truth.
- Provides deterministic standard sections.
- Allows controlled package-specific notes if required.
- Gives a path for richer documentation without uncontrolled drift.

Cons:

- Requires more careful generator implementation.
- Preserved manual sections must be clearly bounded.
- Extension sections may be misused unless validation checks them.

Risks:

- Manual extension sections may become stale.
- Generator complexity increases.

## Decision

Use a generated package README with a standard deterministic structure.

The package-local README path is:

```text
packages/<domain-or-scope>/<package-name>/README.md
apps/<app-name>/README.md
tools/architecture/<tool-name>/README.md
```

The README source of truth is package-local `package.json` architecture metadata.

The generator must use:

```text
package.json
package.json.architecture
```

The generator may also use repository conventions, such as package path and public export entry point.

The README must include a generated-file notice.

Required README structure:

```text
# <package name>

> Generated from package.json architecture metadata. Do not edit generated sections by hand.

## Summary

## Package identity

## Lifecycle

## Ownership

## Responsibilities

## Non-responsibilities

## Public exports and usage

## Boundaries

## Runtime and environments

## Relations

## Operational notes

## Governance

## Validation

## Extension notes
```

Section requirements:

### Summary

Source:

```text
package.json.description
architecture.readme.summary
```

Purpose:

```text
Explain what the package is for in one short section.
```

### Package identity

Source:

```text
package.json.name
package.json.version
package.json.private
package.json.type
architecture.component.type
architecture.component.name
architecture.component.system
architecture.component.domain
architecture.component.boundedContext
architecture.tags
```

Purpose:

```text
Identify the package, its system, its domain, and its bounded context.
```

### Lifecycle

Source:

```text
architecture.lifecycle.stage
architecture.lifecycle.role
architecture.lifecycle.class
architecture.lifecycle.catalogLifecycle
architecture.lifecycle.visibility
architecture.lifecycle.supportLevel
architecture.lifecycle.reviewCadence
```

Purpose:

```text
Show maturity, package role, catalog lifecycle, visibility, support level, and review cadence.
```

### Ownership

Source:

```text
architecture.component.owner
```

Purpose:

```text
Identify who owns the package.
```

### Responsibilities

Source:

```text
architecture.readme.responsibilities
```

Purpose:

```text
State what the package owns.
```

### Non-responsibilities

Source:

```text
architecture.readme.nonResponsibilities
```

Purpose:

```text
State what the package does not own.
```

### Public exports and usage

Source:

```text
package.json.exports
architecture.readme.usage
```

Purpose:

```text
Show supported public entry points and intended usage.
```

This section must not document deep imports as supported usage.

### Boundaries

Source:

```text
architecture.boundaries.publicExportsOnly
architecture.boundaries.deepImportsAllowed
architecture.boundaries.allowedConsumers
architecture.boundaries.forbiddenConsumers
```

Purpose:

```text
Explain package consumption rules.
```

### Runtime and environments

Source:

```text
architecture.runtime.production
architecture.runtime.testOnly
architecture.runtime.serviceName
architecture.runtime.serviceNamespace
architecture.runtime.deploymentEnvironments
```

Purpose:

```text
Explain whether the package participates in runtime/deployment behaviour.
```

### Relations

Source:

```text
architecture.relations.dependsOn
architecture.relations.providesApis
architecture.relations.consumesApis
```

Purpose:

```text
Show declared package and API relationships.
```

### Operational notes

Source:

```text
architecture.readme.operationalNotes
```

Purpose:

```text
Describe relevant support, runtime, or operational notes.
```

### Governance

Source:

```text
architecture.governance.decisionRefs
architecture.governance.semverPolicy
architecture.governance.changeControl
architecture.governance.promotionEligible
```

Purpose:

```text
Show governing ADRs and package governance controls.
```

### Validation

Source:

```text
validation tool output
schema path
generator version or command
```

Purpose:

```text
Show how README output can be regenerated and validated.
```

### Extension notes

Source:

```text
optional preserved manual section
```

Purpose:

```text
Allow controlled package-specific notes only if the generator supports preserving marked sections.
```

Extension sections must be explicitly marked.

Recommended markers:

```text
<!-- BEGIN MANUAL EXTENSION -->
Manual extension notes.
<!-- END MANUAL EXTENSION -->
```

If the generator does not support preserving extension sections, this section must be generated as:

```text
No extension notes.
```

Manual edits outside approved extension markers are not allowed.

The README generator must be deterministic.

Given the same `package.json`, repository path, schema version, and generator version, it must produce the same README output.

## Rationale

Package READMEs are consumer-facing package documentation.

They should be readable by engineers without requiring them to understand the full ADR set first.

The README must still be governed by package metadata.

Generating the README from `package.json` keeps ADR-0005's metadata source-of-truth decision intact.

Keeping the README package-local keeps ADR-0007's layout decision intact.

Using a deterministic standard structure supports review, lifecycle evidence, and package promotion.

The standard sections map directly to existing package metadata fields.

This avoids adding a second package documentation model.

The optional extension section is deliberately constrained.

It gives a future implementation path for package-specific notes without letting the README become an uncontrolled source of truth.

## Consequences

Positive:

- Package READMEs become consistent.
- Package metadata remains the source of truth.
- README drift is reduced.
- Lifecycle, ownership, support, and boundary information is easy to find.
- Package review becomes easier.
- Lifecycle transition evidence can include generated README output.

Negative:

- README quality depends on metadata quality.
- A generator is required.
- Overly terse metadata will produce weak READMEs.
- Extension sections need discipline if enabled.

Neutral / operational:

- README generation tooling is not implemented by this ADR.
- Existing manually written package READMEs should be replaced or migrated when the generator exists.
- The root README remains authored documentation.
- Package-local README files are generated outputs.
- Generated output should be checked in only if repository policy requires package READMEs to exist in source control.
- The generator should fail if required README source fields are missing or invalid.

Future consequences:

- ADR-ACT-0035 can be marked done by this ADR.
- README generator tooling should be implemented after this ADR is accepted.
- The package metadata validator should check enough `architecture.readme` fields to support the generated README.
- Package lifecycle transition evidence should include generated README output.
- First vertical slice should validate whether the generated README is useful to engineers.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, template structure, consistency review, and artifact validation support.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - Related ADRs.
  - ADR process requirements.
  - Package metadata schema.
  - Package metadata validation tooling.
  - Stated architecture constraints.
  - Current artifact layout.

- Validation required:
  - Validate during first vertical slice.
  - Validate against representative app, package, tooling, and test packages.
  - Validate through README generator implementation.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- Package metadata is stored in `package.json`.
- Package README fields exist under `architecture.readme`.
- Package metadata validation tooling exists.
- Package-local README path is part of the repository layout.
- Lifecycle transitions require evidence and generated README output can provide part of that evidence.

Further validation required:

- Implement README generator.
- Generate README output for representative package roles.
- Confirm output is readable and useful.
- Confirm generator rejects unsupported manual edits.
- Confirm validation reports include README generation status when tooling exists.

## Impacted areas

- Architecture:
  - Defines package README structure as a generated artifact.

- Data:
  - Packages with data responsibilities expose responsibilities and non-responsibilities.

- API:
  - Contract packages expose public exports, usage, and relation metadata.

- Security:
  - Ownership, lifecycle, visibility, and support level are visible in package docs.

- Operations:
  - Runtime packages expose service names, namespaces, environments, and operational notes.

- Testing:
  - Test packages expose test-only lifecycle and usage constraints.

- Delivery:
  - Generated README output supports review and package promotion evidence.

- UX:
  - React app and UI package READMEs expose usage, boundaries, and ownership clearly.

- Documentation:
  - Package documentation becomes generated, consistent, and metadata-backed.

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

- Schema and tooling:
  - docs/schemas/package-json-architecture.schema.json
  - tools/architecture/validate-package-metadata/
  - reports/validation/package-metadata-validation.md

- Related future work:
  - Package README generator.
  - Package inventory reporting.
  - Lifecycle transition evidence validation.

## Notes

This ADR defines generated package README structure.

This ADR does not implement the README generator.

This ADR does not change package metadata source of truth.

This ADR does not allow package README files to become independent sources of truth.

This ADR does not select a documentation rendering framework.

This ADR does not require CI integration.
