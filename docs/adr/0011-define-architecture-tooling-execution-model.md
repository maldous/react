# ADR-0011: Define architecture tooling execution model

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

Lifecycle transition rules and lifecycle transition evidence bundle format are defined.

Generated package README structure is defined.

Generated package inventory and lifecycle report structure is defined.

Repository layout and version-control rules are defined.

The accepted architecture now requires several related tools:

```text
package metadata validator
package README generator
package inventory generator
lifecycle report generator
lifecycle transition evidence schema validator
lifecycle transition evidence generator or validator
```

Without a common execution model, each tool may define its own command style, input roots, output behaviour, mutation rules, error behaviour, and generated-file handling.

That would make the tooling hard to run locally, hard to review, and hard to integrate later.

The next design decision is the execution model for architecture tooling.

This ADR defines the local command surface, tool responsibilities, output classes, mutation rules, failure behaviour, and composition rules.

This ADR does not implement the tooling.

CI integration is outside the scope of this ADR.

## Stakeholder concerns

- Product:
  - Architecture tooling should help expose package ownership, maturity, and review state without slowing delivery.
  - Tool output should be understandable to non-specialist reviewers where possible.

- Engineering:
  - Tools should be predictable, local-first, and easy to run before review.
  - Tools should not silently mutate source files unless the command explicitly requests it.
  - Tool failures should identify the package, file, field, and rule.

- Security:
  - Tools should fail closed for invalid metadata and evidence.
  - Security-sensitive transitions should not pass validation without required review evidence.

- Operations:
  - Runtime package metadata, lifecycle state, and operational readiness evidence should be checkable locally.
  - Generated reports should remain reproducible and ignored by default.

- Compliance/governance:
  - Tools should respect source-of-truth boundaries.
  - Generated reports should not become source metadata.
  - Committed evidence should remain under `docs/evidence/`.

- Support:
  - Tools should make ownership, support level, review cadence, and lifecycle state easy to inspect.

## Decision drivers

- Comply with ADR-0001 modular hexagonal boundaries.
- Comply with ADR-0002 bounded-context ownership.
- Comply with ADR-0003 modular monorepo package boundaries.
- Comply with ADR-0004 lifecycle class vocabulary.
- Comply with ADR-0005 package metadata source-of-truth rules.
- Comply with ADR-0006 lifecycle transition governance.
- Comply with ADR-0007 repository layout and version-control rules.
- Comply with ADR-0008 generated package README structure.
- Comply with ADR-0009 package inventory and report structure.
- Comply with ADR-0010 lifecycle transition evidence bundle format.
- Keep tools local-first.
- Keep tool behaviour deterministic.
- Make generated reports reproducible.
- Separate report generation from governance evidence creation.
- Avoid implicit mutation of committed files.
- Avoid CI-specific decisions in this ADR.
- Avoid fragmented one-off script interfaces.

## Options considered

### Option A: Independent scripts with independent command styles

Description:

Each tool defines its own script name, CLI arguments, input conventions, and output behaviour.

Pros:

- Quick to implement.
- Each tool can evolve independently.
- Low upfront coordination.

Cons:

- Command surface drifts.
- Behaviour becomes hard to remember.
- Mutation and validation semantics vary by tool.
- Harder to document and review.
- Harder to integrate later.

Risks:

- Tools silently diverge from ADR decisions.
- Generated outputs are treated inconsistently.
- CI integration later becomes messy.

### Option B: One monolithic architecture tool

Description:

Build one architecture tool that owns validation, README generation, inventory generation, lifecycle report generation, and evidence validation.

Pros:

- Single entry point.
- Centralised command behaviour.
- Easier global configuration.

Cons:

- Larger first implementation.
- Harder to test small slices.
- Can become a bottleneck.
- May hide clear tool boundaries.

Risks:

- Tool grows too quickly.
- Early implementation blocks independent progress.

### Option C: Shared execution model with small composable tools

Description:

Each tool remains small and focused under `tools/architecture/`.

All tools follow the same execution contract.

A later orchestrator may compose them once individual tools exist.

Pros:

- Local-first.
- Supports incremental implementation.
- Keeps tool boundaries clear.
- Gives a consistent command contract.
- Requires orchestration for dependency-managed runs while preserving independently runnable tools.
- Aligns with accepted ADRs and VCS rules.

Cons:

- Requires command contract discipline.
- Some duplication may exist before orchestration.
- Documentation must stay consistent.

Risks:

- Tools may still drift unless validation and README documentation are maintained.
- A later orchestrator may need refactoring if early tools ignore the contract.

## Decision

Use a shared execution model with small composable architecture tools and a required dependency-managing orchestrator.

Architecture tools live under:

```text
tools/architecture/
```

Each tool uses this baseline structure:

```text
tools/architecture/<tool-name>/
  package.json
  README.md
  src/
    index.mjs
  tests/
```

Each tool must support local execution through Node.

Canonical direct command shape:

```text
node tools/architecture/<tool-name>/src/index.mjs [options]
```

The initial tool names are:

```text
validate-package-metadata
generate-package-readmes
generate-package-inventory
generate-lifecycle-reports
validate-lifecycle-evidence
generate-lifecycle-evidence
```

A required orchestrator is defined at:

```text
tools/architecture/orchestrator/
```

The directory name is `orchestrator` so test and implementation paths clearly communicate the tool's purpose.

The orchestrator is required because architecture tooling has run dependencies across metadata validation, README generation, inventory generation, lifecycle reports, and evidence validation.

The orchestrator command shape is:

```text
node tools/architecture/orchestrator/src/index.mjs validate
node tools/architecture/orchestrator/src/index.mjs generate-readmes
node tools/architecture/orchestrator/src/index.mjs generate-inventory
node tools/architecture/orchestrator/src/index.mjs generate-lifecycle-reports
node tools/architecture/orchestrator/src/index.mjs validate-evidence
node tools/architecture/orchestrator/src/index.mjs all
```

The orchestrator is required.

Individual tools remain independently runnable for focused development and debugging.

The orchestrator owns dependency ordering and multi-step workflows.

Individual tools must not reimplement global dependency ordering.

## Input roots

Tools must default to these input roots:

```text
apps/
packages/
tools/architecture/
docs/adr/
docs/schemas/
docs/evidence/
```

Package metadata tools must read package files from:

```text
apps/**/package.json
packages/**/package.json
tools/architecture/**/package.json
```

Schema-aware tools must read schemas from:

```text
docs/schemas/
```

Evidence-aware tools must read committed governance evidence from:

```text
docs/evidence/
```

ADR-aware tools may read accepted ADRs from:

```text
docs/adr/
```

Tools must not read generated reports as source of truth.

Generated reports may be read only as optional comparison inputs when the command explicitly says it is checking reproducibility.

## Output classes

Tool outputs fall into three classes.

### Validation output

Validation output is diagnostic.

It may be printed to stdout.

It may also write generated reports under:

```text
reports/validation/
```

Generated validation reports are ignored by default.

### Generated operational reports

Generated operational reports are reproducible outputs.

They belong under:

```text
reports/
```

Examples:

```text
reports/package-inventory/
reports/lifecycle/
reports/validation/
```

They are ignored by default.

They may be committed only if an accepted ADR or explicit repository policy requires persistent generated review artifacts.

### Committed governance evidence

Governance evidence is retained under:

```text
docs/evidence/
```

Examples:

```text
docs/evidence/lifecycle/
docs/evidence/security/
docs/evidence/operations/
docs/evidence/exceptions/
```

Evidence may be produced by tooling, but it is reviewed and committed as governance material.

Tools that create evidence must make that behaviour explicit.

## Mutation rules

Tools must default to no source mutation unless their primary purpose is generation.

Validation commands must not mutate committed source files by default.

Generation commands must be explicit about what they write.

Required command flags:

```text
--check
  Validate expected output without writing changes.

--write
  Write generated outputs or generated source artifacts.

--root <path>
  Set repository root. Defaults to current working directory.

--format text|json
  Select console output format where useful.
```

Recommended command flags:

```text
--package <name>
  Limit work to one package.

--changed-only
  Limit work to changed packages when a change detector exists.

--include-tools
  Include tools/architecture package metadata.

--no-reports
  Do not write generated report files.

--strict
  Treat warnings as failures.
```

Default behaviour:

```text
validation tools
  equivalent to --check

README generator
  equivalent to --check unless --write is supplied

inventory/report generators
  may write reports only when command intent is generation

evidence generator
  must require --write and explicit package/transition arguments
```

Tools must never silently rewrite package metadata.

Tools must never treat generated reports as source metadata.

Tools must never write lifecycle transition evidence without explicit command intent.

## Failure behaviour

Tools must fail closed.

A tool must exit non-zero when:

```text
required metadata is missing
metadata schema validation fails
lifecycle class does not match stage + role
required generated README content is stale during --check
inventory or lifecycle report output is stale during --check
lifecycle transition evidence is missing required fields
required approval evidence is missing
security review is required but absent
operations review is required but absent
manual edits violate generated-file rules
```

Error output should include:

```text
package name
package path
file path
field path
rule identifier
human-readable message
suggested next action where practical
```

Warnings may be emitted for non-blocking issues.

In `--strict` mode, warnings become failures.


## Run dependency model

The orchestrator must manage run dependencies.

The minimum dependency graph is:

```text
validate-package-metadata
  -> generate-package-readmes --check
  -> generate-package-inventory --check
  -> generate-lifecycle-reports --check
  -> validate-lifecycle-evidence
```

Generation workflows must use this ordering:

```text
validate-package-metadata
  -> generate-package-readmes --write
  -> generate-package-inventory --write
  -> generate-lifecycle-reports --write
```

Evidence validation workflows must use this ordering:

```text
validate-package-metadata
  -> generate-package-readmes --check
  -> generate-package-inventory --check
  -> generate-lifecycle-reports --check
  -> validate-lifecycle-evidence
```

Evidence generation workflows require explicit lifecycle transition intent and must use this ordering:

```text
validate-package-metadata
  -> generate-package-readmes --check
  -> generate-package-inventory --check
  -> generate-lifecycle-reports --check
  -> generate-lifecycle-evidence --write
  -> validate-lifecycle-evidence
```

The orchestrator must stop on the first failed required dependency.

The orchestrator must report which tool failed, which dependency was being satisfied, and what downstream steps were skipped.

The orchestrator must not generate governance evidence during default validation or default `all` runs.

The orchestrator may delegate all work to individual tools.

The orchestrator must not become a second source of package metadata truth.

## Composition rules

Individual tools should be independently runnable.

The required orchestrator composes them.

Composition order for `all` should be:

```text
validate package metadata
generate or check package READMEs
generate or check package inventory
generate or check lifecycle reports
validate lifecycle transition evidence
```

Evidence generation is not part of default `all`.

Evidence generation requires explicit package and transition intent.

This prevents routine validation from creating governance records.

## Generated-file handling

Generated files must include a generated-file notice where practical.

Generated package READMEs are package-local and metadata-backed.

Generated package READMEs may be committed only according to ADR-0007 repository policy.

Generated reports are ignored by default.

Generated reports must be reproducible from committed metadata, schemas, ADRs, and tool versions.

Generated reports must not be hand edited.

Governance evidence under `docs/evidence/` may include generated sections, but the evidence bundle is retained as committed governance evidence after review.

## Configuration

No separate repository-wide architecture configuration file is required by this ADR.

Tool defaults must come from accepted repository paths and package-local metadata.

If a later implementation requires shared configuration, it must be introduced deliberately and must not replace package-local `package.json` architecture metadata.

Tool configuration must not create a second source of truth for package architecture metadata.

## Rationale

The architecture now has enough governance decisions to require tooling.

The tooling should not grow through unrelated scripts with inconsistent behaviour.

A shared execution model gives engineers a predictable local workflow before CI exists.

Small composable tools keep implementation slices manageable.

The model keeps clear artifact boundaries:

```text
package.json
  source of package metadata truth

docs/adr/
  source of architecture decision truth

docs/evidence/
  committed governance evidence

reports/
  generated operational reports, ignored by default

tools/architecture/
  implementation tooling
```

The mutation rules protect source files from accidental rewrites.

The failure rules make tools useful in local review and future CI without making this ADR about CI.

## Consequences

Positive:

- Architecture tooling gets a consistent command contract.
- Tools remain local-first.
- Tooling can be implemented incrementally.
- Generated reports and committed evidence stay separate.
- Future CI integration has a stable foundation.
- Error output becomes easier to act on.

Negative:

- Tool implementations must follow stricter conventions.
- Some command-line options may feel repetitive across tools.
- The orchestrator must be implemented early enough to manage multi-step runs.

Neutral / operational:

- This ADR does not implement tooling.
- CI integration is outside the scope of this ADR.
- Existing validation tooling should be aligned to this command contract where practical.
- Future tools should document their supported flags in their package README.
- Generated reports remain ignored by default.
- Governance evidence remains committed under `docs/evidence/`.

Future consequences:

- The orchestrator should be implemented before or alongside the first dependency-managed multi-tool workflow.
- ADR-ACT-0054 should implement `generate-package-readmes` using this execution model.
- ADR-ACT-0058 should implement `generate-package-inventory` and `generate-lifecycle-reports` using this execution model.
- ADR-ACT-0061 should create lifecycle evidence schema.
- ADR-ACT-0062 should implement lifecycle evidence validation or generation using this execution model.
- A future ADR may define CI integration after the local orchestrator and tooling contract have been implemented and validated.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, tooling command model design, mutation/failure rule design, and consistency validation against ADR-0001 through ADR-0010.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - ADR-0001 modular hexagonal architecture.
  - ADR-0002 bounded contexts.
  - ADR-0003 modular monorepo package boundaries.
  - ADR-0004 lifecycle classes.
  - ADR-0005 package metadata source of truth.
  - ADR-0006 lifecycle transition governance.
  - ADR-0007 architecture artifact layout and version-control rules.
  - ADR-0008 generated package README structure.
  - ADR-0009 package inventory and report structure.
  - ADR-0010 lifecycle transition evidence bundle format.
  - Current validation tooling and package metadata.

- Validation required:
  - Validate by aligning existing package metadata validator with this command contract.
  - Validate with first implementation of package README generator.
  - Validate with first implementation of package inventory and lifecycle report generators.
  - Validate with first implementation of lifecycle evidence validator or generator.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- Accepted ADRs define package metadata, generated README, generated reports, evidence, layout, and version-control boundaries.
- Existing package metadata validator already follows part of the proposed layout.
- Implementation actions exist for README generation, inventory generation, report generation, evidence schema, and evidence validation.

Further validation required:

- Align existing validator options with this ADR where required.
- Implement at least two tools using the shared contract.
- Confirm command names and flags are usable by engineers.
- Confirm generated reports stay ignored by default.
- Confirm evidence generation requires explicit intent.

## Impacted areas

- Architecture:
  - Defines architecture tooling execution model.

- Data:
  - Metadata and report tooling uses package-local metadata as source of truth.

- API:
  - Contract package validation and evidence tooling use the same execution model.

- Security:
  - Security-sensitive lifecycle evidence checks fail closed when review is required.

- Operations:
  - Runtime and support evidence checks use the same execution model.

- Testing:
  - Tooling supports local validation and future test automation.

- Delivery:
  - Local-first tooling prepares for later CI without defining CI now.

- UX:
  - Generated package README tooling follows predictable command behaviour.

- Documentation:
  - Tool READMEs document each tool's command surface and generated-file behaviour.

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
  - docs/adr/0010-define-lifecycle-transition-evidence-bundle-format.md

- Schema and tooling:
  - docs/schemas/package-json-architecture.schema.json
  - tools/architecture/validate-package-metadata/

- Evidence taxonomy:
  - docs/evidence/

- Related future work:
  - Package README generator.
  - Package inventory generator.
  - Lifecycle report generator.
  - Lifecycle evidence schema.
  - Lifecycle evidence validator or generator.
  - Required architecture tooling orchestrator.
  - Future CI integration ADR, if required.

## Notes

This ADR defines architecture tooling execution model, including the required orchestrator.

This ADR does not implement architecture tooling.

CI integration is outside the scope of this ADR.

This ADR does not introduce a repository-wide architecture configuration source of truth.

This ADR does not change package metadata source of truth.

This ADR keeps generated reports separate from committed governance evidence.

This ADR does not allow governance evidence to be treated as generated reports.
