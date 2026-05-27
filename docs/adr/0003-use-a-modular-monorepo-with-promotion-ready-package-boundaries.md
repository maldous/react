# ADR-0003: Use a modular monorepo with promotion-ready package boundaries

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

The architecture uses modular hexagonal boundaries.

Bounded contexts are the primary product/domain boundary.

The next decision is where application code, shared packages, domain modules, adapters, generated types, tests, tooling, and documentation should live.

The decision must also account for future enterprise growth where some packages may need to become independently versioned external packages or separate repositories.

The product is expected to include multiple application surfaces and shared capabilities, including:

- web application
- backend API
- domain modules
- application use cases
- infrastructure adapters
- generated API/client types
- shared UI components
- shared testing utilities
- documentation
- CI and local development tooling

A repository structure decision is needed before defining package and implementation-module naming conventions, import-boundary enforcement, build tooling, and the first vertical slice.

Package and monorepo vocabulary must align with ADR-0001's language principle.

ADR-0003 owns the package/repository structure vocabulary layer.

Package identity and dependency language should align with `package.json`.

Catalog-facing package concepts should align with Backstage-compatible component, system, owner, domain, API, and dependency language where practical.

Architecture visualisation language should remain compatible with C4 software system, container, and component concepts.

Boundary-enforcement language should remain compatible with Nx-style project tags and dependency constraints.

This does not make Backstage, C4, Nx, or any package manager the source of truth.

It means the package model should be easy to project into those ecosystems without translation-heavy naming.

Vocabulary clarification:

```text
package
  package-manager unit represented by package.json and governed by ADR-0005 metadata

module
  internal implementation unit inside an application or package

component
  externally recognisable catalog/architecture concept that may be projected from package metadata

system
  Backstage/C4-compatible grouping concept for related components

tag
  Nx-compatible enforcement vocabulary generated from package metadata

public export
  supported package entry point declared through package.json exports

deep import
  import that bypasses a package's public exports
```

ADR-0003 uses `package` when describing source-control and package-manager boundaries.

ADR-0003 uses `module` only for internal implementation structure.

The main risk is scattering related code across separate repositories too early or placing everything in one unstructured application folder.

There are also two specific long-term risks:

- minor isolated changes could trigger full CI workflows if the monorepo is not designed around affected-package execution
- boundaries could become loose if packages are not treated as future versioned distributions with explicit public contracts

The repository structure should support modularity without prematurely creating distributed services.

It should also support later promotion of selected packages into separately versioned distributions or polyrepos after initial development and architectural validation.

## Stakeholder concerns

- Product:
  - Features should be delivered as coherent vertical slices.
  - Product capability should not be delayed by unnecessary repository coordination.
  - Shared functionality should be reusable across product surfaces.

- Engineering:
  - Domain, application, adapter, API, and UI packages need clear boundaries.
  - Changes spanning multiple packages should be easy to review and test together.
  - Local development should remain simple.

- Security:
  - Shared security and access-control code should be consistent.
  - Secrets and runtime configuration should not leak across packages.

- Operations:
  - Build, test, and deployment artefacts should be reproducible.
  - Operational tooling should have a clear location.

- Data:
  - Data contracts, migrations, generated types, and adapters should be versioned with the code that uses them.

- Users/customers:
  - Product behaviour should remain consistent across interfaces.

- Compliance/governance:
  - Decision records, documentation, and change evidence should live with the system they describe.

- Support:
  - Support engineers should be able to find related implementation, documentation, and operational behaviour in one repository.

## Decision drivers

- Support modular hexagonal architecture.
- Support bounded contexts.
- Keep related changes versioned together.
- Make vertical-slice delivery practical.
- Avoid premature multi-repository coordination.
- Avoid a single unstructured application.
- Support generated types and shared contracts.
- Support local development with one workspace.
- Support future extraction of packages or services if needed.
- Enable boundary enforcement through tooling and CI.
- Avoid full CI execution for minor isolated changes.
- Support affected-package build and test workflows.
- Allow stable packages to be versioned independently.
- Allow fast-moving packages to iterate without premature publishing overhead.
- Preserve the option to promote packages into polyrepos later.

## Options considered

### Option A: Single application repository with internal folders only

Description:

Keep all code inside one application repository with folders such as `src/domain`, `src/services`, `src/api`, and `src/ui`.

Pros:

- Simple to start.
- Low tooling overhead.
- Easy local navigation.
- Good for a small prototype.

Cons:

- Package boundaries are weaker.
- Shared code ownership becomes unclear.
- Import rules are harder to enforce.
- Application code can become tightly coupled.
- Multiple apps or runtimes are harder to support cleanly.

Risks:

- The codebase may become a modular-looking monolith without enforceable boundaries.
- Framework code may leak into domain/application code.

### Option B: Multi-repository architecture

Description:

Place major parts of the platform in separate repositories, such as web, API, domain libraries, infrastructure, and data pipelines.

Pros:

- Strong repository-level separation.
- Independent release and access controls.
- Useful for large teams with mature ownership boundaries.

Cons:

- High coordination overhead.
- Cross-repository changes become slower.
- Generated contracts and shared types are harder to keep aligned.
- Local development becomes harder.
- Premature for an early product architecture.

Risks:

- Teams spend too much effort coordinating repositories instead of validating product architecture.
- Version drift appears between API, client, domain, and data contracts.

### Option C: Modular monorepo with promotion-ready package boundaries

Description:

Use one repository containing multiple apps and packages.

Applications, domain modules, adapters, generated contracts, tooling, tests, and documentation are versioned together but organised as explicit packages.

Each package is designed as if it may later become a separately versioned distribution or separate repository.

Pros:

- Supports modular architecture while keeping related changes together.
- Enables vertical-slice changes across UI, API, domain, and adapters.
- Supports shared types, contracts, and tooling.
- Easier local development than multi-repo.
- Enables import-boundary checks.
- Supports future extraction if a package needs independent lifecycle later.
- Allows stable packages to evolve toward independent versioning.
- Allows fast-moving product packages to iterate without publishing overhead.

Cons:

- Requires workspace tooling.
- Requires boundary discipline.
- CI needs affected-package execution.
- Repository size and dependency graph can grow.
- Package lifecycle classes must be defined and reviewed.

Risks:

- Without enforcement, the monorepo can become a large ball of mud.
- Shared packages may become dumping grounds.
- Build and test performance can degrade without caching and affected-task execution.
- Promotion to external packages or polyrepos may be harder if public exports and dependency rules are not defined early.

### Option D: Polyrepo with generated SDK/package distribution

Description:

Use separate repositories but publish generated SDKs, shared packages, or contracts between them.

Pros:

- Clear release boundaries.
- Works for mature platform organisations.
- Strong separation between producer and consumer repositories.

Cons:

- Requires package publishing/versioning discipline.
- Slower iteration for early vertical slices.
- More operational setup.
- Contract changes require careful rollout.

Risks:

- Product learning slows down.
- Teams may over-invest in distribution mechanics before validating architecture.

## Decision

Use a modular monorepo as the initial development and architecture validation model.

All packages must be designed with explicit ownership, public exports, dependency rules, and test boundaries so they can later be promoted to separately versioned packages or extracted into polyrepos.

Promotion should occur only when justified by one or more of:

- stable public contract
- independent owner
- independent release cadence
- external consumers
- security or compliance boundary
- different deployment lifecycle
- high reuse value
- slow-changing contract compared with fast-moving product code

The monorepo must support affected-package build and test workflows so minor isolated changes do not require unnecessary full CI execution.

The monorepo is a source-control and development boundary, not a licence to ignore module boundaries.

Boundaries will be enforced through package structure, public exports, dependency rules, code review, and later CI checks.

Initial repository shape should follow this direction:

```text
apps/
  web/
  api/

packages/
  domain/
  application/
  ports/
  adapters/
  graphql/
  ui/
  config/
  testing/

docs/
  adr/
  principles/
```

The exact package names may change after context mapping and the first vertical slice.

## Rationale

A modular monorepo with promotion-ready package boundaries best supports the chosen modular hexagonal architecture and bounded-context model.

It allows related changes across UI, API, domain, data, and tests to be made atomically while the architecture is still being validated.

It keeps generated contracts and shared types close to their consumers during early development.

It avoids premature polyrepo coordination while preserving a professional enterprise path toward independently versioned packages or separate repositories.

A single unstructured application repository is too weak for the intended modular architecture.

A multi-repository structure is more appropriate after ownership boundaries, package stability, release cadence, and deployment independence are proven.

A polyrepo/package-publishing model is useful later, but using it too early adds dependency management, publishing, version drift, regression testing, and local-development overhead before the architecture has been validated.

The chosen posture is:

```text
Start centralised for learning.
Design modularly for extraction.
Promote only after stability is proven.
Use tooling to prevent monorepo coupling.
Use versioning discipline for packages that behave like external products.
```

## Consequences

Positive:

- Vertical slices can include UI, API, domain, adapter, test, and documentation changes in one pull request.
- Shared contracts and generated types can be versioned with consumers during early development.
- Local development is simpler than multi-repo.
- Import-boundary enforcement becomes practical.
- Future service, package, or repository extraction remains possible.
- ADRs, principles, and implementation stay together.
- Stable packages can later move toward independent versioning.
- Fast-moving packages can iterate without premature publishing overhead.

Negative:

- Workspace tooling is required.
- Boundary discipline must be enforced.
- CI must avoid running unnecessary work as the repository grows.
- Shared packages can become dumping grounds without ownership rules.
- Repository size can grow over time.
- Package lifecycle classification adds governance work.
- Promotion to polyrepo later requires discipline around public exports, contracts, compatibility, and dependency direction.

Neutral / operational:

- A separate ADR should decide import-boundary enforcement.
- A separate ADR should decide build/test orchestration tooling.
- A separate ADR should decide package naming conventions.
- ADR-0004 defines package lifecycle classes.
- Package metadata vocabulary is defined by ADR-0005 and should project cleanly into package, catalog, diagram, and boundary-enforcement views.
- The action register should track module/package structure implementation.
- The first vertical slice should validate that the monorepo layout is not excessive.
- CI should use affected-package workflows where practical.
- Packages with `releaseable` visibility should use explicit versioning and compatibility checks when they become stable.

Future consequences:

- Some packages may remain internal and fast-moving indefinitely.
- Some packages may become stable internal libraries with independent versions.
- Some packages may be published as external distributions.
- Some packages may be extracted into polyrepos if team ownership, deployment, security, or lifecycle needs justify it.
- Promotion should be a deliberate decision, not an accidental consequence of repository growth.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, option comparison, and consistency review.

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

- Existing accepted ADRs require modular boundaries and bounded contexts.
- The action register identifies package/module structure as a high-priority dependency.
- Architecture reasoning shows monorepo best balances modularity with early delivery speed.
- Comparison against single app repository, multi-repo, and polyrepo package distribution.

Further validation required:

- Implement the initial package and implementation-module structure.
- Run one vertical slice through the proposed layout.
- Confirm dependency boundaries can be enforced.
- Confirm local development remains simple.
- Confirm CI can target affected packages.
- Confirm stable packages can be versioned independently where needed.
- Confirm fast-moving packages are not burdened by premature release mechanics.
- Confirm public exports and dependency rules support future extraction.

## Impacted areas

- Architecture:
  - Defines the repository boundary and initial package structure direction.

- Data:
  - Data adapters, migrations, generated contracts, and data access packages live in the monorepo.

- API:
  - API boundary and generated API contracts live alongside domain/application packages.

- Security:
  - Shared security utilities and access-control modules require clear package ownership.

- Operations:
  - Operational scripts, local development services, and deployment support files live with the product.

- Testing:
  - Test utilities and package-specific tests can be versioned with the implementation.

- Delivery:
  - Vertical-slice pull requests can span multiple apps and packages.
  - CI should run affected builds and tests instead of full workflows for isolated changes.
  - Stable/releaseable packages may require version, changelog, compatibility, and regression checks.

- UX:
  - Shared UI components and design tokens can live alongside product applications.

- Documentation:
  - ADRs, principles, package docs, and implementation evidence live in the repository.

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

- Architecture decision process:
  - docs/adr/README.md
  - docs/adr/README.md
  - docs/adr/0000-template.md
  - docs/adr/ACTION-REGISTER.md

- Accepted ADRs:
  - docs/adr/0001-use-modular-hexagonal-architecture.md
  - docs/adr/0002-model-the-platform-around-bounded-contexts.md

- Package vocabulary references:
  - npm and Node.js package.json package manifest language.
  - Backstage component/system/domain/owner/API relationship language.
  - C4 software system/container/component language.
  - Nx project tag and dependency constraint language.

- Related ADRs:
  - docs/adr/0004-define-package-lifecycle-classes.md
  - docs/adr/0005-define-package-metadata-format.md

- Related future ADRs:
  - Package metadata vocabulary and format is defined by ADR-0005.
  - Package promotion criteria and review process.
  - Affected-package CI workflow.
  - Import-boundary enforcement.
  - Build/test orchestration.
  - Package and implementation-module naming conventions.
  - Local development services.

## Notes

This ADR does not choose Nx, Turborepo, pnpm workspaces, Yarn workspaces, npm workspaces, Make, Taskfile, or any specific build orchestrator.

This ADR does not decide which packages will later be promoted to external distributions or polyrepos.

This ADR decides the initial repository strategy and the required posture that package boundaries remain promotion-ready.

Tooling, versioning, package lifecycle, affected CI, and promotion process decisions should be recorded separately.
