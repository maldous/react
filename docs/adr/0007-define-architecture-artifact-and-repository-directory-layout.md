# ADR-0007: Define architecture artifact and repository directory layout

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

The architecture uses modular hexagonal boundaries and treats architecture vocabulary as part of the architecture.

Bounded contexts are the primary product/domain boundary.

The repository model is a modular monorepo with promotion-ready package boundaries.

Package lifecycle classes are defined.

`package.json` is the package metadata source of truth.

Lifecycle transition governance is defined.

The package architecture metadata schema is stored at:

```text
docs/schemas/package-json-architecture.schema.json
```

This ADR governs that path and the surrounding architecture artifact layout.

The architecture baseline needs a clear directory layout so future artifacts do not drift into arbitrary locations.

The directory layout must distinguish between:

```text
architecture decision records
action register
schemas
committed governance evidence
implementation tooling
package-local metadata
generated reports when they exist
```

Without a layout decision, future implementation work may create multiple competing locations for schemas, validation scripts, generated READMEs, catalog descriptors, governance evidence, diagrams, and reports.

That would undermine the single-source-of-truth package metadata model and lifecycle governance model.

The layout also needs to support a full modern React solution.

That does not mean every package is a React package.

It means the repository layout must support:

```text
React application packages
shared UI packages
feature packages
domain packages
application/use-case packages
adapter packages
contract/API packages
tooling packages
test packages
```

Modern React applications commonly separate route/application entry points, UI components, hooks, server-state/data access, feature modules, tests, and build configuration.

The architecture layout should support that shape while preserving ADR-0001 hexagonal boundaries and ADR-0005 package metadata ownership.

## Stakeholder concerns

- Product:
  - Architecture artifacts should be easy to find and review.
  - Generated documentation should not be confused with source decisions.

- Engineering:
  - Schemas, validators, generated outputs, and package metadata need predictable paths.
  - Package-local metadata should remain close to package code.
  - Repository-level governance artifacts should not be mixed into application runtime code.

- Security:
  - Security and supply-chain metadata should have predictable locations.
  - Generated reports should be distinguishable from source metadata.
  - Committed governance evidence should be distinguishable from generated reports.

- Operations:
  - Runtime/deployment generated outputs and operational reports should be easy to locate.
  - Generated artifacts should not become accidental sources of truth.

- Data:
  - Data contracts, schemas, and package metadata should be organised predictably.
  - Future data-governance artifacts need an allocated layout area.

- Compliance/governance:
  - ADRs, action registers, schemas, governance evidence, validation outputs, and generated reports should be traceable.
  - Decision files should remain separate from implementation tooling and generated outputs.

- Support:
  - Package inventory and lifecycle reports should be discoverable without reading all packages manually.

## Decision drivers

- Keep ADRs as the source of architecture decisions.
- Keep `package.json` as the source of package-local architecture metadata.
- Avoid duplicate sources of truth.
- Give schemas a stable repository location.
- Give validation tooling a stable repository location.
- Give committed governance evidence a stable repository location.
- Give generated reports a stable repository location when reports are needed.
- Keep generated files clearly separate from source decisions.
- Support ADR-0005 package metadata validation.
- Support ADR-0006 lifecycle transition evidence bundles.
- Support future Backstage, C4, Nx, OpenTelemetry, Kubernetes, and SPDX outputs only when they are actually implemented, without pre-creating speculative source-like directories.
- Keep paths conventional and easy to understand.
- Support a full modern React application structure without forcing React-specific folders into non-React packages.
- Keep React UI concerns separate from domain, application, adapter, and contract packages.
- Avoid over-engineering before implementation needs are real.

## Options considered

### Option A: Leave layout informal

Description:

Allow implementation artifacts to be created wherever they seem useful at the time.

Pros:

- Fast.
- No upfront layout decision.
- Flexible.

Cons:

- Creates path drift.
- Makes artifacts hard to find.
- Encourages duplicate schemas or validators.
- Weakens ADR-0005's single-source-of-truth model.
- Makes future automation harder.

Risks:

- Tooling depends on unstable paths.
- Generated outputs become confused with source decisions.

### Option B: Put all architecture artifacts under docs/adr

Description:

Place ADRs, schemas, reports, generated outputs, and validation tooling under `docs/adr`.

Pros:

- Everything architecture-related is in one tree.
- Easy to find initially.

Cons:

- Mixes decisions with implementation artifacts.
- Makes ADR directory noisy.
- Blurs source decisions and derived artifacts.
- Poor fit for schemas and tooling.

Risks:

- ADR directory becomes a dumping ground.
- Reviewers confuse generated or implementation artifacts with decisions.

### Option C: Separate decisions, schemas, reports, and tooling under explicit top-level areas

Description:

Keep ADRs under `docs/adr`, schemas under `docs/schemas`, committed governance evidence under `docs/evidence`, generated reports under root-level `reports`, and tooling under `tools`.

Package README files stay inside their packages.

Do not create speculative generated-output directories or repository-level generated README directories until an accepted ADR or implementation need requires them.

Pros:

- Clear separation of concerns.
- Keeps ADRs focused.
- Gives governance evidence a stable documentation path.
- Gives schemas stable documentation paths.
- Gives tooling stable implementation paths.
- Keeps package README generation package-local.
- Avoids speculative generated-output directories.
- Aligns with ADR-0005 and ADR-0006.

Cons:

- Requires one more layout decision.
- Requires tooling to follow path conventions.
- Future generated-output tooling may need a later path decision.

Risks:

- Some paths may need refinement after real use.
- Reports may need substructure once report types become concrete.

### Option D: Put schemas and tooling inside each package

Description:

Keep package metadata schema, validation scripts, generated README templates, and package reports inside package directories.

Pros:

- Very close to package code.
- Easy for package authors to see local artifacts.

Cons:

- Duplicates repository-level governance.
- Harder to keep schema and validator versions consistent.
- Weak fit for global package inventory.
- Weak fit for cross-package validation.

Risks:

- Multiple package-local schemas drift.
- Cross-package validation becomes harder.

## Decision

Use explicit, separated architecture artifact layout.

The accepted layout is:

```text
docs/
  adr/
    README.md
    0000-template.md
    ACTION-REGISTER.md
    0001-*.md
    0002-*.md
    ...

  schemas/
    README.md
    package-json-architecture.schema.json

  specs/
    YYYY-MM-DD-<topic>-design.md

  evidence/
    lifecycle/
    architecture/
    security/
    operations/
    testing/
    release/
    exceptions/
    import-boundaries/
    naming/
    platform-scope/
    e2e/

  slices/
    <action-id>.json

reports/
  package-inventory/
  lifecycle/
  validation/

tools/
  architecture/
    validate-package-metadata/
    validate-source-imports/
    generate-package-readmes/
    generate-package-inventory/
    generate-lifecycle-reports/
    validate-lifecycle-evidence/
    orchestrator/

apps/
  web/
    package.json
    README.md
    index.html
    src/
      main.tsx
      app/
      routes/
      features/
      components/
      hooks/
      services/
      styles/
      tests/
    public/

packages/
  <domain-or-scope>/
    <package-name>/
      package.json
      README.md
      src/
        index.ts
      tests/
```

## Package and React application skeleton

The baseline package skeleton is metadata-first:

```text
packages/
  <domain-or-scope>/
    <package-name>/
      package.json
      README.md
      src/
        index.ts
      tests/
```

Required package files:

```text
package.json
  Source of truth for package metadata, including the ADR-0005 architecture object.

README.md
  Generated from package.json architecture metadata when README generation tooling exists.

src/
  Package implementation.

src/index.ts
  Public export entry point for packages with source/runtime exports.

tests/
  Package-local tests and lifecycle evidence.
```

Optional package folders are role-aware.

They should be added only when useful:

```text
src/domain/
src/application/
src/adapters/
src/components/
src/hooks/
src/services/
tests/unit/
tests/integration/
tests/contract/
fixtures/
stories/
```

The package layout must not force empty architecture folders into every package.

The required baseline exists to support:

```text
package metadata validation
README generation
public export enforcement
lifecycle transition evidence
affected-package CI
import-boundary checks
```

Modern React application skeleton:

```text
apps/
  web/
    package.json
    README.md
    index.html
    src/
      main.tsx
      app/
      routes/
      features/
      components/
      hooks/
      services/
      styles/
      tests/
    public/
```

React application folder intent:

```text
src/main.tsx
  Client entry point.

src/app/
  Application shell, providers, route wiring, and cross-cutting UI composition.

src/routes/
  Route modules or route configuration.

src/features/
  Feature-level React UI and feature orchestration.

src/components/
  Shared application-level UI components.

src/hooks/
  Shared React hooks.

src/services/
  Client-side service adapters, API clients, and server-state integration boundaries.

src/styles/
  Application-level styling entry points.

src/tests/
  Application-level tests.

public/
  Static public assets.
```

React-specific folders belong in React apps or UI packages.

They should not be forced into domain, contract, adapter, tooling, or test packages unless the package role requires them.

A shared UI package may use this shape:

```text
packages/
  ui/
    components/
      package.json
      README.md
      src/
        index.ts
        components/
        hooks/
        styles/
      tests/
      stories/
```

A feature package with React UI may use this shape:

```text
packages/
  <domain>/
    <feature-name>/
      package.json
      README.md
      src/
        index.ts
        components/
        hooks/
        services/
        state/
      tests/
```

Domain or application packages should avoid React-specific folders unless they explicitly own UI behaviour.

The React skeleton is a supported layout, not a universal package requirement.

Canonical source locations:

| Concern                                               | Source location                                      | Source of truth                                                               |
| ----------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Architecture decisions                                | `docs/adr/`                                          | ADR files                                                                     |
| ADR action tracking                                   | `docs/adr/ACTION-REGISTER.md`                        | Action register                                                               |
| Design specs (pre-implementation and as-built)        | `docs/specs/`                                        | Design spec files                                                             |
| Lifecycle transition evidence                         | `docs/evidence/lifecycle/`                           | Committed governance evidence                                                 |
| Architecture review evidence                          | `docs/evidence/architecture/`                        | Committed governance evidence                                                 |
| Security review evidence                              | `docs/evidence/security/`                            | Committed governance evidence                                                 |
| Operations readiness evidence                         | `docs/evidence/operations/`                          | Committed governance evidence                                                 |
| Architecture-level test evidence                      | `docs/evidence/testing/`                             | Committed governance evidence                                                 |
| Release or promotion evidence                         | `docs/evidence/release/`                             | Committed governance evidence                                                 |
| Accepted exceptions                                   | `docs/evidence/exceptions/`                          | Committed governance evidence                                                 |
| Import boundary validation evidence                   | `docs/evidence/import-boundaries/`                   | Committed governance evidence                                                 |
| Package naming validation evidence                    | `docs/evidence/naming/`                              | Committed governance evidence                                                 |
| Platform scope validation evidence                    | `docs/evidence/platform-scope/`                      | Committed governance evidence                                                 |
| Quality gate baseline evidence                        | `docs/evidence/quality-gates/`                       | Committed governance evidence                                                 |
| Frontend platform baseline evidence                   | `docs/evidence/frontend/`                            | Committed governance evidence                                                 |
| Observability and runtime baseline evidence           | `docs/evidence/observability/`                       | Committed governance evidence                                                 |
| Identity and access control baseline evidence         | `docs/evidence/identity/`                            | Committed governance evidence                                                 |
| Infrastructure provisioning baseline evidence         | `docs/evidence/infrastructure/`                      | Committed governance evidence                                                 |
| E2E test substrate evidence                           | `docs/evidence/e2e/`                                 | Committed governance evidence                                                 |
| Vertical slice delivery evidence                      | `docs/evidence/vertical-slices/`                     | Committed governance evidence for completed vertical slices                   |
| i18n runtime baseline evidence                        | `docs/evidence/i18n/`                                | Committed governance evidence for i18n runtime and locale baseline            |
| Developer platform baseline evidence                  | `docs/evidence/developer-platform/`                  | Committed governance evidence for developer tooling baseline audits           |
| Slice readiness manifests                             | `docs/slices/`                                       | Slice dependency declarations; governed by ADR-0024                           |
| Playwright E2E configuration                          | `playwright.config.ts`                               | Committed E2E configuration; gitignores playwright-report/ and e2e-results/   |
| Playwright E2E tests                                  | `e2e/`                                               | Committed E2E test source; artifacts (traces/videos) gitignored               |
| Compose integration smoke tests                       | `tests/integration/`                                 | Live-service tests; not run in CI; requires compose up                        |
| Root TypeScript strict base config                    | `tsconfig.base.json`                                 | Extended by `apps/**/tsconfig.json`; governs strict mode                      |
| App TypeScript configs                                | `apps/**/tsconfig.json`                              | App-level TypeScript project config; extends tsconfig.base.json               |
| Docker service configuration files                    | `docker/<service>/`                                  | Config files mounted into compose services (OTel, etc.)                       |
| Declarative infrastructure provisioning               | `infra/`                                             | Terraform/OpenTofu modules, env configs, and bin wrapper (ADR-0023)           |
| Package metadata schema                               | `docs/schemas/package-json-architecture.schema.json` | ADR-0005 and ADR-0006 implemented as schema                                   |
| Package metadata                                      | package-local `package.json`                         | `package.json` architecture object                                            |
| Package README                                        | package-local `README.md`                            | Generated from `package.json` metadata                                        |
| Package README outputs                                | package-local `README.md`                            | Generated output only                                                         |
| Package inventory reports                             | `reports/package-inventory/`                         | Generated output only                                                         |
| Lifecycle reports                                     | `reports/lifecycle/`                                 | Generated output only                                                         |
| Validation reports                                    | `reports/validation/`                                | Generated output only                                                         |
| Backstage/C4/Nx/OpenTelemetry/Kubernetes/SPDX outputs | No reserved path                                     | Future generated output only; no directory reserved by this ADR               |
| Architecture tooling                                  | `tools/architecture/`                                | Implementation tooling, not decision source                                   |
| React SPA application implementation                  | `apps/react-enterprise-app/`                         | Browser-only Vite SPA; no server/BFF code                                     |
| Node BFF/API application implementation               | `apps/platform-api/`                                 | Server substrate: migrations, seed, health/readiness/version, session fixture |
| React application implementation (generic)            | `apps/web/` or later app-specific path               | Application source, package-local metadata, generated README                  |
| Package implementation                                | `apps/` and `packages/`                              | Source code and package-local metadata                                        |

`docs/schemas/package-json-architecture.schema.json` is the canonical schema path.

Nested schema directories are avoided unless multiple schema families require them.

Generated outputs must not become independent sources of truth.

Reports are root-level generated operational artifacts, not authored documentation.

Governance evidence is committed documentation under `docs/evidence/`, not a generated report.

Evidence categories are:

```text
docs/evidence/lifecycle/
  Package lifecycle transition evidence.

docs/evidence/architecture/
  Boundary, context, package-structure, and architecture compliance evidence.

docs/evidence/security/
  Security-sensitive approval and supply-chain review evidence.

docs/evidence/operations/
  Runtime, support, deployment, rollback, and operational readiness evidence.

docs/evidence/testing/
  Architecture-level acceptance and validation evidence that must be retained.

docs/evidence/release/
  Release, promotion, compatibility, and migration evidence.

docs/evidence/exceptions/
  Accepted deviations, temporary waivers, and risk acceptances.

docs/evidence/import-boundaries/
  Import boundary scan results committed as governance evidence.

docs/evidence/naming/
  Package naming validation results committed as governance evidence.

docs/evidence/platform-scope/
  Platform scope validation results committed as governance evidence.

docs/evidence/quality-gates/
  Quality gate baseline evidence: tooling configured, gate types, ignored paths, validation results.

docs/evidence/frontend/
  Frontend platform baseline evidence: selected libraries, package boundary rules, component layer.

docs/evidence/observability/
  Observability and runtime diagnostics evidence: logging stack, trace propagation, error types, redaction policy.

docs/evidence/identity/
  Identity and access control evidence: identity model, role model, permission list, SSO boundary, session model.

docs/evidence/infrastructure/
  Infrastructure provisioning evidence: provisioning tool policy, ownership model, environment model, secrets policy.

docs/evidence/e2e/
  End-to-end test substrate evidence: Playwright config, fixture session mode, E2E test summary, known deferrals.

docs/evidence/vertical-slices/
  Vertical slice delivery evidence: completed slice summaries, packages created, test counts, fixture roles validated, and constraint compliance.

docs/evidence/i18n/
  i18n runtime baseline evidence: locale resource files, key resolver implementation, interpolation safety, and server helper baseline.

docs/evidence/developer-platform/
  Developer platform baseline evidence: tooling audit covering Compose profiles, Make targets, E2E modes, Tilt status, i18n status, API contracts, dev container, dependency automation, and local development docs.
```

Reports may reference evidence.

Evidence may reference generated reports.

Neither reports nor evidence replaces package-local `package.json` metadata or accepted ADRs.

Future generated outputs for Backstage, C4, Nx, OpenTelemetry, Kubernetes, or SPDX should not receive repository paths until implementation exists.

Any generated artifact must include a generated-file notice where practical.

Package-local `package.json` remains the source of truth for package architecture metadata.

Package-local `README.md` must be generated from package metadata when package README generation tooling exists.

Repository-level generated package README copies should not exist by default.

The repository may use `apps/` and `packages/` as the initial implementation layout from ADR-0003.

A later ADR may refine application/package layout if the first vertical slice shows a better structure.

## Version control requirements

Commit these source-of-truth and governance files:

```text
README.md
package.json
package-lock.json
docs/adr/**
docs/schemas/**
docs/specs/**
docs/evidence/**
tools/architecture/**
tsconfig.base.json
apps/**/tsconfig.json
docker/**
infra/**
tests/integration/**
apps/**/package.json
apps/**/package-lock.json
packages/**/package.json
apps/**/src/**
packages/**/src/**
apps/**/tests/**
packages/**/tests/**
```

Commit package-local generated README files only when repository policy requires package READMEs to be present in source control:

```text
apps/**/README.md
packages/**/README.md
tools/architecture/**/README.md
```

When package-local generated README files are committed, they must be reproducible from package metadata and must include a generated-file notice.

Generated reports are ignored by default.

Do not commit generated operational reports by default:

```text
reports/**
```

Generated reports should be produced by tooling when needed.

Generated reports may be committed only when an accepted ADR or explicit repository policy requires persistent review artifacts.

Do not commit transient build, dependency, cache, or coverage outputs:

```text
node_modules/
dist/
build/
coverage/
.tmp/
.cache/
.next/
.vite/
.turbo/
.nx/cache/
```

Do not commit generated package inventory, lifecycle, validation, catalog, diagram, or dashboard outputs unless explicitly governed:

```text
reports/package-inventory/**
reports/lifecycle/**
reports/validation/**
```

Do commit reviewed lifecycle transition evidence:

```text
docs/evidence/lifecycle/**
```

Do commit reviewed exception records:

```text
docs/evidence/exceptions/**
```

Version-control rule summary:

| Artifact class                 | Path                                                                               | Git treatment                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ADRs                           | `docs/adr/**`                                                                      | Commit                                                                          |
| Action register                | `docs/adr/ACTION-REGISTER.md`                                                      | Commit                                                                          |
| Schemas                        | `docs/schemas/**`                                                                  | Commit                                                                          |
| Design specs                   | `docs/specs/**`                                                                    | Commit                                                                          |
| Governance evidence            | `docs/evidence/**`                                                                 | Commit                                                                          |
| Architecture tooling           | `tools/architecture/**`                                                            | Commit                                                                          |
| Package metadata               | `apps/**/package.json`, `packages/**/package.json`                                 | Commit                                                                          |
| TypeScript configs             | `tsconfig.base.json`, `apps/**/tsconfig.json`                                      | Commit                                                                          |
| Infrastructure provisioning    | `infra/**`                                                                         | Commit (ADR-0023) ? HCL, .tfvars.example, bin/tf; excludes .tfvars and .tfstate |
| Docker service configs         | `docker/**`                                                                        | Commit                                                                          |
| Root lock file                 | `package-lock.json`                                                                | Commit                                                                          |
| App lock files                 | `apps/**/package-lock.json`                                                        | Commit                                                                          |
| Package source/tests           | `apps/**/src/**`, `packages/**/src/**`, `apps/**/tests/**`, `packages/**/tests/**` | Commit                                                                          |
| Package-local generated README | `apps/**/README.md`, `packages/**/README.md`, `tools/architecture/**/README.md`    | Commit only if repository policy requires generated package READMEs in source   |
| Generated reports              | `reports/**`                                                                       | Ignore by default                                                               |
| Build/dependency/cache outputs | `node_modules/`, `dist/`, `build/`, `coverage/`, `.cache/`, `.tmp/`                | Ignore                                                                          |

## Rationale

This layout keeps architecture decision records separate from schemas, design specs, committed governance evidence, tooling, and generated outputs.

It defines the governed location for schemas, governance evidence, tooling, reports, apps, and package-local artifacts.

The chosen schema path is appropriate because the schema is documentation-adjacent, architecture-governed, and repository-wide.

It should not live inside a single package because it governs every package's `package.json` architecture metadata.

It should not live inside `docs/adr` because it is an implementation artifact derived from ADRs, not an ADR.

It should not live only inside tooling because it is a reference contract for humans, editors, and CI.

The layout supports ADR-0005 by keeping package metadata source-of-truth local to package `package.json`.

The layout supports ADR-0006 by giving lifecycle evidence, validation, reports, and tooling predictable homes while keeping evidence outside generated reports.

The layout allows future generated outputs for Backstage, C4, Nx, OpenTelemetry, Kubernetes, and SPDX if implementation work later requires them.

The package skeleton is intentionally minimal.

It requires enough structure to enforce metadata, README generation, public exports, tests, and lifecycle evidence.

It does not require every package to mimic a React application.

The React application skeleton is included because the intended solution includes a modern React front end.

React app folders are kept under `apps/` so UI composition does not leak into domain, contract, or adapter packages.

Shared UI packages and feature packages may use React folders when their package role requires UI behaviour.

## Consequences

Positive:

- Schema location is now governed.
- The schema path is `docs/schemas/package-json-architecture.schema.json`.
- ADR directory remains focused on decisions.
- Package metadata remains package-local.
- Generated outputs are separated from source decisions.
- Governance evidence is separated from generated reports.
- Tooling locations are predictable.
- Future generated outputs are deliberately not given reserved directories until implementation exists.
- Implementation work can proceed without ad-hoc paths.
- Package implementation skeleton is now explicit.
- Modern React application layout is supported without forcing React structure into every package.

Negative:

- Some directories may remain empty until tooling exists.
- The layout may feel broad before all report and tooling needs are implemented.
- Tooling needs to follow the path conventions.

Neutral / operational:

- Empty directories do not need to be committed unless required by tooling or repository policy.
- Report directories should be created by tooling when outputs exist and ignored by default unless governed otherwise.
- Generated outputs should be reproducible.
- The schema path should not change without a new ADR or amendment.
- Package-local `README.md` generation should be implemented after the README template decision.
- If a generated output is never needed, no directory is created for it.

Future consequences:

- First vertical slice should validate the React app and package skeleton.
- ADR-ACT-0034 should create validation tooling under `tools/architecture/validate-package-metadata/`.
- ADR-ACT-0035 should define package README generation paths using this layout.
- ADR-ACT-0043 should implement lifecycle transition validation under `tools/architecture/validate-lifecycle-evidence/`.
- Future generated-output tooling should define an output path when the output is actually implemented.
- Future reports should write under root-level `reports/`.
- Future governance evidence should write under `docs/evidence/`.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, directory layout modelling, package/React skeleton modelling, and artifact validation support.

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

- ADR-0003 requires a modular monorepo with promotion-ready package boundaries.
- ADR-0005 requires package metadata in package-local `package.json`.
- ADR-0005 requires generated README output from package metadata.
- ADR-0006 requires lifecycle evidence bundles and validation.
- ADR-ACT-0033 created `docs/schemas/package-json-architecture.schema.json`.
- Cross-review identified that directory layout had not yet been explicitly governed.

Further validation required:

- Validate the layout during the first vertical slice.
- Validate the React application skeleton during the first modern React implementation.
- Implement package metadata validation tooling using the schema path.
- Implement generated README tooling using package-local `package.json`.
- Confirm generated reports are reproducible, normally ignored, and not manually edited.
- Confirm future generated outputs are treated as generated views only.
- Confirm governance evidence is committed under `docs/evidence/`.

## Impacted areas

- Architecture:
  - Defines where architecture decisions and derived artifacts live.

- Data:
  - Future data metadata, evidence, and reports can use governed paths without inventing locations.

- API:
  - Future API contract package outputs can use package-local metadata and generated reports.

- Security:
  - Future security and supply-chain reports have predictable report areas.

- Operations:
  - Lifecycle evidence has a committed governance path and validation reports have generated report locations.

- Testing:
  - Validation tooling paths support future tests and CI.

- Delivery:
  - CI can rely on stable schema and tooling paths.

- UX:
  - Package README generation has a predictable source and output model.

- Documentation:
  - ADRs, schemas, governance evidence, generated reports, and tooling are separated.

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
  - docs/adr/0008-define-generated-package-readme-structure.md
  - docs/adr/0009-define-package-inventory-and-report-structure.md
  - docs/adr/0010-define-lifecycle-transition-evidence-bundle-format.md

- Evidence artifact classes:
  - docs/evidence/lifecycle/
  - docs/evidence/architecture/
  - docs/evidence/security/
  - docs/evidence/operations/
  - docs/evidence/testing/
  - docs/evidence/release/
  - docs/evidence/exceptions/
  - docs/evidence/import-boundaries/
  - docs/evidence/naming/
  - docs/evidence/platform-scope/

- Schema artifact:
  - docs/schemas/package-json-architecture.schema.json
  - docs/schemas/README.md

- ADR process:
  - docs/adr/README.md
  - docs/adr/0000-template.md
  - docs/adr/ACTION-REGISTER.md

- Related future work:
  - Package metadata validation tooling.
  - Package README generation tooling.
  - Lifecycle transition validation tooling.
  - Package inventory reporting.
  - Generated-output tooling, if later required.

## Notes

This ADR governs architecture artifact layout.

This ADR defines a baseline package and React application skeleton.

This ADR does not finalise every application source-code directory.

This ADR does not select a React router, server-state library, component library, styling system, or build tool.

This ADR does not require empty generated-output directories to be committed.

This ADR defines `docs/schemas/package-json-architecture.schema.json` as the canonical schema path.

This ADR preserves ADR-0005's rule that package-local `package.json` is the package metadata source of truth.

This ADR preserves ADR-0006's rule that lifecycle transitions are governed events supported by metadata, validation, evidence bundles, and review.

This ADR defines version-control treatment for committed governance artifacts and generated outputs.
