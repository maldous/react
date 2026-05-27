# ADR-0012: Define architecture tooling test, validation, TUI, and self-evidence strategy

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

Lifecycle transition rules, evidence bundles, generated package READMEs, generated inventory reports, repository layout, and architecture tooling execution model are defined.

ADR-0011 defines a required architecture tooling orchestrator at:

```text
tools/architecture/orchestrator/
```

Implementation work is expected for:

```text
validate-package-metadata
validate-source-imports
generate-package-readmes
generate-package-inventory
generate-lifecycle-reports
validate-lifecycle-evidence
orchestrator
```

The architecture tooling must be held to a strict engineering standard.

It must be testable, locally deterministic, fail-closed, explainable, and auditable.

It must also produce evidence for itself.

A TUI may improve usability, but it must not become a separate execution path or source of truth.

Third-party validation tools may improve quality, but they must not replace the repository's governed rules.

This ADR defines the testing strategy, validation strategy, third-party validator usage, TUI rules, quality gates, and self-evidence model for architecture tooling.

This ADR does not implement tests, validators, or a TUI.

CI integration is outside the scope of this ADR.

## Stakeholder concerns

- Product:
  - Architecture tooling should be reliable enough to support delivery and package review decisions.
  - Tool output should be understandable to reviewers.

- Engineering:
  - Tools should follow established software engineering patterns.
  - Tests should be fast, local, deterministic, and easy to run.
  - Tools should use third-party validators where they add real value.
  - The orchestrator should prove dependency order, stop-on-failure behaviour, and no-default-evidence-generation behaviour.
  - TUI behaviour should not diverge from CLI/orchestrator behaviour.

- Security:
  - Security-sensitive lifecycle evidence checks must fail closed.
  - Missing required security review evidence must fail validation.
  - Third-party dependencies used for validation must be deliberate and reviewed.

- Operations:
  - Runtime package evidence, support level, deployment environment, and rollback fields should be validated through fixtures.
  - Tests and validation must not rely on network access or live services.

- Compliance/governance:
  - Generated reports should not be committed as source artifacts.
  - Governance evidence fixtures should not be confused with real committed evidence.
  - Tools should emit self-evidence showing what was checked, what passed, what failed, and which versions/rules were used.
  - TUI output should display the same evidence model as the CLI.

- Support:
  - Tool failures should be clear, actionable, and traceable.

## Decision drivers

- Comply with ADR-0005 package metadata source-of-truth rules.
- Comply with ADR-0006 lifecycle transition governance.
- Comply with ADR-0007 repository layout and version-control rules.
- Comply with ADR-0008 generated package README structure.
- Comply with ADR-0009 generated package inventory and lifecycle report structure.
- Comply with ADR-0010 lifecycle transition evidence bundle format.
- Comply with ADR-0011 architecture tooling execution model and required orchestrator.
- Keep tests local-first.
- Keep validation deterministic.
- Use established validators where they improve correctness.
- Keep governed repository rules as the final authority.
- Avoid network dependencies.
- Verify fail-closed behaviour.
- Verify no-mutation behaviour for `--check`.
- Verify write behaviour for `--write`.
- Verify TUI does not bypass the orchestrator.
- Require tools to produce self-evidence.
- Keep generated reports out of committed source artifacts.
- Keep real governance evidence under `docs/evidence/`.
- Keep test evidence fixtures inside test fixture paths.

## Options considered

### Option A: Test tools only through manual runs

Description:

Developers manually run tooling commands and inspect output.

Pros:

- No test harness work.
- Fastest initial implementation.

Cons:

- Does not prove deterministic behaviour.
- Does not catch regressions.
- Does not validate fail-closed behaviour.
- Does not protect against accidental source mutation.
- Does not test orchestrator dependency ordering.
- Does not produce durable self-evidence.

Risks:

- Tooling becomes trusted without evidence.
- Package metadata and lifecycle governance rules are enforced inconsistently.

### Option B: Unit tests only

Description:

Each tool has unit tests for internal functions, but no CLI, fixture, output, TUI, or self-evidence tests.

Pros:

- Fast.
- Easy to write.
- Good for pure validation logic.

Cons:

- Does not test command-line contract.
- Does not test actual file layout.
- Does not test generated output stability.
- Does not test orchestrator workflows.
- Does not prove TUI and CLI consistency.
- Does not prove self-evidence correctness.

Risks:

- CLI breaks while unit tests pass.
- Tools mutate files unexpectedly.
- Generated output drift is missed.
- TUI displays misleading status.

### Option C: Local deterministic test and validation strategy with third-party validators, TUI rules, quality gates, and self-evidence

Description:

Each architecture tool has local deterministic tests covering pure logic, fixtures, CLI behaviour, generated output stability, failure cases, mutation rules, third-party validator integration, and self-evidence output.

The required orchestrator has explicit dependency-order tests.

A TUI may be implemented only as a presentation layer over orchestrator commands and evidence output.

Pros:

- Proves local-first behaviour.
- Tests actual command contracts.
- Supports safe implementation before CI.
- Catches output drift.
- Catches accidental mutation.
- Catches broken orchestrator dependency handling.
- Uses established validation tools where useful.
- Makes the tooling auditable through self-evidence.
- Keeps TUI behaviour aligned with orchestrator behaviour.

Cons:

- More upfront test design.
- Requires fixture maintenance.
- Golden outputs need deliberate updates when templates change.
- Requires self-evidence schema or report discipline.
- Third-party validators require dependency review.

Risks:

- Overly broad fixtures may become hard to maintain.
- Golden files may be updated without careful review unless review practice is disciplined.
- TUI may grow into a second workflow unless constrained.

## Decision

Use a strict local deterministic architecture tooling quality strategy.

This strategy includes:

```text
tests
validation
third-party validator usage
orchestrator dependency tests
TUI rules
quality gates
tool self-evidence
```

Each architecture tool must use this baseline test layout:

```text
tools/architecture/<tool-name>/
  tests/
    fixtures/
      valid/
      invalid/
    *.test.mjs
```

Generator tools (`generate-package-readmes`, `generate-package-inventory`, `generate-lifecycle-reports`) additionally require a `golden/` fixture directory for output stability tests. The `invalid/` directory for generator tools contains packages with missing or malformed architecture metadata to test error handling paths. Validator tools (`validate-package-metadata`, `validate-source-imports`, `validate-lifecycle-evidence`) must have both `valid/` and `invalid/` fixture directories.

The required orchestrator must use this test layout:

```text
tools/architecture/orchestrator/
  tests/
    dependency-order.test.mjs
    failure-stop.test.mjs
    no-default-evidence-generation.test.mjs
    check-mode.test.mjs
    write-mode.test.mjs
    self-evidence.test.mjs
```

Orchestrator tests run against the live repository root via `spawnSync` rather than self-contained fixture directories. This ensures the orchestrator is exercised against real package metadata and avoids maintaining a parallel mini-repository fixture. The live repo serves as the orchestrator's integration fixture.

The orchestrator test path must contain `orchestrator`.

The orchestrator path is:

```text
tools/architecture/orchestrator/
```

## Required test categories

Each architecture tool must have tests for the categories that apply to that tool.

### Unit tests

Purpose:

```text
Test pure validation, parsing, path resolution, dependency graph, and generation functions.
```

Requirements:

```text
No network access.
No repository-global side effects.
No dependency on current machine paths.
```

### Fixture-based tests

Purpose:

```text
Test representative valid and invalid package metadata, README inputs, report inputs, and evidence inputs.
```

Required fixture roots:

```text
tests/fixtures/valid/
tests/fixtures/invalid/
```

Fixture packages should cover:

```text
React app package
UI package
domain package
application/use-case package
adapter package
contract package
tooling package
test-only package
deprecated package
external package
runtime package
```

### CLI tests

Purpose:

```text
Test the command interface defined by ADR-0011.
```

Required behaviour:

```text
--check exits zero when output is valid
--check exits non-zero when output is stale or invalid
--write writes only documented outputs
--root <path> scopes execution to a fixture repository
--format json emits parseable JSON when supported
--strict turns warnings into failures
```

### Fail-closed tests

Purpose:

```text
Prove invalid metadata, invalid generated output, missing evidence, and missing required reviews fail.
```

Required failure cases:

```text
missing architecture metadata
invalid lifecycle class
stage and role mismatch
missing owner
invalid generated README
stale inventory report
missing lifecycle evidence field
missing security review when required
missing operations review when required
manual edit outside generated-file markers
```

### No-mutation tests

Purpose:

```text
Prove check mode does not mutate source files, committed governance evidence, generated README files, or generated report files.
```

Required checks:

```text
hash fixture before command
run command with --check
hash fixture after command
assert no file content changes
```

### Write-mode tests

Purpose:

```text
Prove write mode writes only documented paths.
```

Required checks:

```text
--write updates generated package README files only for README generator
--write updates reports/** only for report generators
--write creates docs/evidence/** only for explicit evidence generation
--write never rewrites package metadata
```

### Golden output tests

Purpose:

```text
Prove generated README, inventory, lifecycle report, and evidence outputs are stable.
```

Golden outputs should live under tool test fixtures.

Example:

```text
tools/architecture/generate-package-readmes/tests/fixtures/golden/
tools/architecture/generate-package-inventory/tests/fixtures/golden/
tools/architecture/generate-lifecycle-reports/tests/fixtures/golden/
tools/architecture/generate-lifecycle-evidence/tests/fixtures/golden/
```

Golden files must not be confused with real generated reports or real governance evidence.

Golden files are test fixtures.

### Orchestrator dependency-order tests

Purpose:

```text
Prove the required orchestrator runs architecture tools in the dependency order defined by ADR-0011.
```

Required tests:

```text
metadata validation runs before README checks
README checks run before inventory checks
inventory checks run before lifecycle report checks
lifecycle report checks run before evidence validation
generation workflows use write-mode ordering
evidence generation requires explicit transition intent
default all does not generate governance evidence
```

### Orchestrator failure-stop tests

Purpose:

```text
Prove downstream steps are skipped after failed required dependencies.
```

Required tests:

```text
metadata failure skips README, inventory, lifecycle report, and evidence steps
README failure skips inventory, lifecycle report, and evidence steps
inventory failure skips lifecycle report and evidence steps
lifecycle report failure skips evidence validation
failure output identifies failed tool and skipped downstream steps
```

## Third-party validator usage

Architecture tooling should use established third-party validators where they improve correctness, maintainability, or standards conformance.

Required third-party validator categories:

```text
JSON Schema validation
Markdown lint or Markdown structure validation
package.json validation
CLI argument parsing validation where useful
```

Recommended examples:

```text
Ajv for JSON Schema validation.
markdownlint-compatible validation for Markdown style and structure.
Node built-in test runner for local tests.
A stable argument parser only if command complexity requires it.
```

Third-party validators are not the source of architecture truth.

They enforce rules derived from accepted ADRs, schemas, and package metadata.

Third-party dependencies must be:

```text
declared in the relevant tool package.json
pinned through the repository lockfile when a lockfile exists
used locally without network access during tests
covered by fixture tests
reviewed before introduction
```

When a third-party validator cannot express a governed rule, the tool must add repository-specific validation logic.

The repository-specific governed rules take precedence over generic tool defaults.

## Dual-layer validation

Each architecture rule should be validated at the strongest practical layer.

Use two layers where useful:

```text
schema validation
  validates structure, required fields, enums, and basic formats

semantic validation
  validates cross-field, cross-file, lifecycle, boundary, evidence, and source-of-truth rules
```

Examples:

```text
JSON Schema validates lifecycle.stage exists.
Semantic validation checks lifecycle.class equals lifecycle.stage + "." + lifecycle.role.

JSON Schema validates evidence.review.status is an allowed enum.
Semantic validation checks securityReviewCompleted is true when securityReviewRequired is true.

Markdown structure validation checks required headings exist.
Semantic validation checks generated README content matches package metadata.
```

A rule must not be considered covered only because a schema exists.

If a rule depends on multiple fields or files, it needs semantic validation.

## Tool self-evidence

Every architecture tool must produce evidence for its own run.

Self-evidence is generated operational evidence.

It belongs under:

```text
reports/tooling/
```

Self-evidence is ignored by default.

Self-evidence may be committed only if a later accepted ADR or repository policy requires persistent generated review artifacts.

Each tool run should be able to emit JSON self-evidence.

Recommended path:

```text
reports/tooling/<tool-name>/<timestamp>-run.json
```

The orchestrator should be able to emit an aggregate self-evidence file.

Recommended path:

```text
reports/tooling/orchestrator/<timestamp>-run.json
```

Self-evidence must include:

```text
toolName
toolVersion
command
mode
root
startedAt
finishedAt
durationMs
inputRoots
outputPaths
rulesEvaluated
checksPassed
checksFailed
warnings
errors
dependencySteps
gitTreatment
exitCode
```

For orchestrator runs, self-evidence must also include:

```text
dependencyOrder
stepsRun
stepsSkipped
failedStep
stopReason
evidenceGenerationRequested
evidenceGenerated
```

Self-evidence must not include secrets.

Self-evidence must not include raw environment dumps.

Self-evidence must not become a source of truth.

Self-evidence records what tooling did, not what the architecture decision is.

## TUI rules

A TUI may be implemented to improve review and local usability.

The TUI must be a presentation layer over the orchestrator.

The TUI must not:

```text
bypass the orchestrator
implement separate validation rules
write package metadata directly
write lifecycle evidence without explicit transition intent
treat generated reports as source of truth
hide failed checks
```

The TUI must show:

```text
orchestrator command being run
dependency steps
pass/fail status
warnings
failed rule identifiers
paths written
self-evidence path
whether evidence generation was requested
whether generated reports were written
whether committed governance evidence was written
```

The TUI must support non-interactive parity.

Every action available in the TUI must map to an orchestrator command that can run without the TUI.

The TUI is optional.

The CLI/orchestrator remains canonical.

## Test command model

Each tool should support a local test command through its package manifest.

Recommended command:

```text
node --test tests/*.test.mjs
```

Tool package scripts should use:

```json
{
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

The orchestrator test command should use:

```text
node --test tests/*.test.mjs
```

The repository may later add a root-level convenience command, but this ADR does not require it.

## Fixture rules

Fixtures must be self-contained.

Fixtures must not depend on the live repository state except where a test explicitly validates the live artifact set.

Fixtures must not require network access.

Fixtures must not read secrets or environment-specific configuration.

Fixtures must use temporary output directories for generated reports.

Fixtures may contain synthetic governance evidence under fixture paths.

Real governance evidence remains under:

```text
docs/evidence/
```

Test fixture governance evidence must remain under:

```text
tools/architecture/<tool-name>/tests/fixtures/
tools/architecture/orchestrator/tests/fixtures/
```

## Generated test output rules

Tests may create generated reports under temporary directories.

Tests must not leave generated reports under repository root `reports/`.

Tests must clean up temporary generated output.

Tests must not require committed `reports/**`.

Tests must not write real governance evidence under `docs/evidence/**` unless an explicit integration test is deliberately validating repository-level evidence behaviour.

Default tests must not mutate committed source files.

## Test evidence and real evidence boundary

Test fixtures are not governance evidence.

Test fixture paths may include synthetic evidence examples.

Real lifecycle transition evidence belongs under:

```text
docs/evidence/lifecycle/
```

Real accepted exceptions belong under:

```text
docs/evidence/exceptions/
```

Tests may validate real evidence only through explicit repository validation commands.

The default unit and fixture test suite should not depend on real governance evidence existing.

## Quality gates

Architecture tooling is not acceptable unless these gates pass:

```text
tests pass locally
validator self-tests pass
fixture tests cover valid and invalid cases
--check mode is no-mutation
--write mode writes only documented paths
generated output is stable against golden fixtures
orchestrator dependency-order tests pass
orchestrator failure-stop tests pass
default all does not generate governance evidence
third-party validators run without network access
semantic validation covers cross-field and cross-file rules
tool self-evidence is emitted in JSON
TUI actions, if implemented, map to orchestrator commands
```

A tool must not be considered review-ready if it lacks self-evidence for its own validation run.

## Rationale

Architecture tooling enforces governance rules.

Governance tooling must itself be tested and evidenced.

Unit tests alone are not enough because these tools are file-system, CLI, generator, evidence, and orchestration oriented.

Third-party validators improve standards conformance, but accepted ADRs remain the source of governed behaviour.

Dual-layer validation prevents false confidence from schema-only checks.

Self-evidence makes tool runs auditable.

TUI rules prevent a convenience interface from becoming a second workflow.

The test path includes `orchestrator` so the path communicates purpose and avoids confusion with the broader `tools/architecture/` area.

Keeping test evidence fixtures separate from real `docs/evidence/` prevents test data from becoming governance material.

## Consequences

Positive:

- Tooling behaviour becomes testable before CI.
- Orchestrator dependency management becomes provable.
- Generated output stability becomes reviewable.
- Accidental source mutation can be caught.
- Fail-closed behaviour can be verified.
- Third-party validators improve standards conformance.
- Tool self-evidence makes validation auditable.
- TUI behaviour remains consistent with CLI/orchestrator behaviour.

Negative:

- More fixture maintenance is required.
- Golden outputs need deliberate review when templates change.
- Tool implementation must include test harness and self-evidence work.
- Third-party validators require dependency review.

Neutral / operational:

- This ADR does not implement tests, validators, or a TUI.
- CI integration is outside the scope of this ADR.
- Tests should run locally with Node's built-in test runner unless a later ADR changes the test runner.
- Tests must not require network access.
- Generated reports remain ignored by default.
- Tool self-evidence under `reports/tooling/` is ignored by default.
- Real governance evidence remains committed under `docs/evidence/`.
- The CLI/orchestrator remains canonical even if a TUI is added.

Future consequences:

- ADR-ACT-0066 should align validator tests and self-evidence with this strategy.
- ADR-ACT-0067 should implement orchestrator tests under `tools/architecture/orchestrator/tests/`.
- ADR-ACT-0068 should validate dependency-order, failure-stop, no-default-evidence-generation, and self-evidence behaviour.
- Future generators should add golden-output tests.
- Future lifecycle evidence tooling should add fail-closed security and operations review tests.
- A future TUI must wrap the orchestrator and pass parity tests.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, test taxonomy design, validator strategy, TUI boundary design, self-evidence model, fixture path design, orchestrator test design, and consistency validation against ADR-0001 through ADR-0011.

- Human review status:
  - Accepted by architecture owner / technical lead.

- Evidence checked:
  - ADR-0005 package metadata source of truth.
  - ADR-0006 lifecycle transition governance.
  - ADR-0007 repository layout and version-control rules.
  - ADR-0008 generated package README structure.
  - ADR-0009 generated package inventory and lifecycle report structure.
  - ADR-0010 lifecycle transition evidence bundle format.
  - ADR-0011 architecture tooling execution model and required orchestrator.
  - Existing package metadata validator test path.

- Validation required:
  - Validate by aligning existing package metadata validator tests with this ADR.
  - Validate during required orchestrator implementation.
  - Validate with first README generator and inventory generator implementations.
  - Validate with first lifecycle evidence validator implementation.
  - Validate TUI parity if a TUI is implemented.

## Validation / evidence

Evidence level:

Medium

Evidence used:

- Existing package metadata validator includes a test file under `tools/architecture/validate-package-metadata/tests/`.
- ADR-0011 requires a dependency-managing orchestrator.
- ADR-0011 requires tools to fail closed.
- ADR-0007 separates generated reports from committed governance evidence.
- The architecture tooling set is about to expand beyond one validator.

Further validation required:

- Add fixture coverage for representative package roles.
- Add third-party JSON Schema validation through Ajv or equivalent.
- Add Markdown structure validation for generated README output.
- Add orchestrator dependency-order tests.
- Add no-mutation tests for `--check`.
- Add write-mode tests for generators.
- Add golden-output tests for generated README and report tooling.
- Add fail-closed tests for lifecycle evidence validation.
- Add tool self-evidence output validation.
- Add TUI parity tests if a TUI is implemented.

## Impacted areas

- Architecture:
  - Defines how architecture tooling is tested, validated, evidenced, and optionally presented.

- Data:
  - Metadata fixtures test package metadata correctness.

- API:
  - Contract package fixtures test API lifecycle and compatibility evidence.

- Security:
  - Security-sensitive evidence fixtures test required review failures.

- Operations:
  - Runtime package fixtures test deployment, support, and rollback evidence.

- Testing:
  - Establishes the architecture tooling test and validation strategy.

- Delivery:
  - Local deterministic tests and self-evidence prepare implementation work before CI.

- UX:
  - TUI, if implemented, must wrap the orchestrator and display the same evidence model.

- Documentation:
  - Tool READMEs should document their test commands, fixture model, validators, self-evidence output, and TUI parity if applicable.

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
  - docs/adr/0005-define-package-metadata-format.md
  - docs/adr/0006-define-package-lifecycle-transition-rules.md
  - docs/adr/0007-define-architecture-artifact-and-repository-directory-layout.md
  - docs/adr/0008-define-generated-package-readme-structure.md
  - docs/adr/0009-define-package-inventory-and-report-structure.md
  - docs/adr/0010-define-lifecycle-transition-evidence-bundle-format.md
  - docs/adr/0011-define-architecture-tooling-execution-model.md

- Tooling:
  - tools/architecture/validate-package-metadata/tests/validate-package-metadata.test.mjs

- Evidence taxonomy:
  - docs/evidence/

- Related future work:
  - Validator test alignment.
  - Orchestrator implementation tests.
  - Generator golden-output tests.
  - Lifecycle evidence fail-closed tests.
  - Tool self-evidence output.
  - Optional TUI parity tests.

## Notes

This ADR defines architecture tooling test, validation, TUI, and self-evidence strategy.

This ADR does not implement tests, validators, or a TUI.

CI integration is outside the scope of this ADR.

This ADR does not change the architecture tooling execution model.

This ADR keeps orchestrator tests under `tools/architecture/orchestrator/tests/`.

This ADR keeps test fixtures separate from real governance evidence.

This ADR keeps the CLI/orchestrator canonical if a TUI is added.
