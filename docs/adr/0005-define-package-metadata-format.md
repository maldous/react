# ADR-0005: Define package metadata vocabulary and format

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
- npm package.json documentation
- Node.js package documentation
- Backstage Software Catalog descriptor format
- Domain-Driven Design / bounded-context vocabulary
- C4 model vocabulary
- Nx module-boundary and tag vocabulary
- OpenTelemetry semantic conventions
- JSON Schema validation vocabulary
- Kubernetes recommended labels
- SPDX software supply-chain vocabulary
- Architecture review support

## Context

The architecture uses modular hexagonal architecture and treats vocabulary as part of the architecture.

Bounded contexts are the primary product/domain boundary and define the domain vocabulary layer.

The repository model is a modular monorepo with promotion-ready package boundaries and a defined package/repository vocabulary layer.

Package lifecycle classes use the format:

```text
<stage>.<role>
```

ADR-0004 also owns the package lifecycle vocabulary layer and requires every package classification to include:

```text
domain
lifecycleStage
packageRole
lifecycleClass
owner
```

This decision defines where package metadata is recorded, what vocabulary is used, how values are named, how the metadata stays aligned with established external concepts, and how tooling can parse it.

The schema vocabulary should not be invented casually.

The schema should cherry-pick established vocabulary from recognised models where the meaning matches the product's needs.

The goal is not to adopt external schemas wholesale.

The goal is to make package metadata externally understandable and future-projectable without maintaining translation-heavy mappings.

Separate metadata files and manually maintained README metadata are avoided because they create drift risk.

The human-readable README must be generated from package metadata.

The machine-readable metadata must therefore contain enough information to generate the README completely.

The platform uses JavaScript/TypeScript package conventions. The standard package manifest for JavaScript packages is `package.json`.

Node.js and npm use `package.json` for package identity, dependencies, module type, entry points, and public exports.

The metadata decision should therefore extend the existing package manifest rather than introduce a new per-package metadata file.

Without a standard metadata vocabulary and format, package lifecycle classes and domain ownership will remain informal documentation.

That creates predictable problems:

- package ownership becomes unclear
- package lifecycle class becomes stale or inconsistent
- CI cannot reliably apply affected-package rules
- import-boundary enforcement cannot reason about package type
- package promotion cannot be assessed consistently
- future Backstage, C4, Nx, OpenTelemetry, deployment, or supply-chain views require translation mappings
- third-party stakeholders cannot understand package support expectations
- package README files may drift away from machine-readable metadata

The platform needs package metadata that is human-readable through generated documentation and machine-parseable through package manifests.

## Stakeholder concerns

- Product:
  - Package maturity and ownership should be understandable during planning.
  - Stable or external-facing packages should have clear support expectations.
  - Package README files should not drift from approved package metadata.
  - Future external stakeholders should understand package metadata without learning a private vocabulary.

- Engineering:
  - Package metadata should be easy to maintain.
  - Tooling should parse package domain, lifecycle stage, role, owner, exports, and support expectations.
  - Package boundaries should support affected CI and import checks.
  - Metadata should reuse existing package standards where practical.
  - Metadata should be projectable into Backstage, C4, Nx, OpenTelemetry, and other views without translation-heavy mapping.

- Security:
  - Security-sensitive packages should identify owners and support state.
  - External or releaseable packages should have clearer review and version expectations.
  - Runtime and dependency-surface metadata should support security review.
  - Future supply-chain metadata should align with SPDX-style vocabulary where practical.

- Operations:
  - Operationally critical packages should be identifiable.
  - Maintenance, external, and deprecated packages should have support expectations.
  - Runtime naming should be compatible with OpenTelemetry service and deployment terminology where practical.
  - Deployment projections should be compatible with Kubernetes recommended label language where practical.

- Data:
  - Data contracts, migrations, generated types, and adapters need clear ownership and lifecycle metadata.
  - Data-related future metadata should fit under a predictable data vocabulary group.

- Users/customers:
  - Stable product behaviour depends on clear ownership and compatibility expectations for shared packages.

- Compliance/governance:
  - Package promotion, deprecation, and externalisation should be traceable.
  - Package metadata should support review and audit.
  - Generated documentation should preserve traceability to the source metadata.
  - Standard vocabulary alignment should reduce future onboarding and audit explanation cost.

- Support:
  - Support teams should be able to identify who owns a package and whether it is active, stable, maintenance, external, or deprecated.

## Decision drivers

- Use standard package metadata practices where possible.
- Avoid introducing a new package metadata file if `package.json` can support the need.
- Use externally recognisable vocabulary where the meaning fits.
- Avoid adopting external schemas wholesale.
- Avoid creating private terms when established terms are adequate.
- Make package ownership explicit.
- Make lifecycle classification parseable by tooling.
- Keep package metadata close to the package.
- Make package README content generated from metadata, not manually maintained.
- Avoid duplicated source-of-truth fields.
- Support affected-package CI.
- Support import-boundary enforcement.
- Support package promotion and semver decisions.
- Support future Backstage-compatible catalog projection.
- Support future C4-compatible architecture views.
- Support future Nx-compatible tags and dependency constraints.
- Support future OpenTelemetry-compatible runtime naming.
- Support future Kubernetes-compatible deployment labels.
- Support future SPDX-compatible supply-chain metadata.
- Source domain values from ADR-0002 context map and glossary.
- Source lifecycle stage and role values from ADR-0004.
- Keep the schema extensible for future lifecycle, security, API, data, runtime, operational, and supply-chain governance.

## Options considered

### Option A: Invent a fully custom package vocabulary

Description:

Define private vocabulary for all package metadata fields without reference to external models.

Pros:

- Full control over field names.
- No need to reconcile with external concepts.
- Can be optimised only for this product.

Cons:

- Future external consumers need translation.
- Developer portal, diagram, CI, observability, deployment, and supply-chain integrations require mapping layers.
- New team members must learn private terminology.
- Public standards and tooling cannot be reused as easily.

Risks:

- Metadata becomes internally meaningful but externally awkward.
- Tooling integrations become more expensive.

### Option B: Adopt one external schema wholesale

Description:

Use a complete external schema such as Backstage catalog descriptors as the package metadata source.

Pros:

- Strong external alignment.
- Existing vocabulary and tooling.
- Easier future catalog integration.

Cons:

- No single external schema covers all current needs.
- Backstage is strong for catalog/discovery but not sufficient for package-local lifecycle, runtime/test-only classification, import-boundary policy, affected CI, semver policy, and generated package README content.
- C4 is a modelling vocabulary, not a package metadata schema.
- Nx is enforcement-oriented, not a full package governance schema.
- OpenTelemetry is runtime/telemetry-oriented, not a package governance schema.
- SPDX is supply-chain-oriented, not a package architecture schema.

Risks:

- The product becomes constrained by a schema designed for a different purpose.
- Important ADR-0003 and ADR-0004 concepts are flattened or lost.

### Option C: Use package.json with a custom architecture object and vocabulary aligned to established models

Description:

Use standard `package.json` fields for package-manager metadata and a single project-specific `architecture` object for package governance metadata.

Field names inside `architecture` deliberately align with established models where the meaning fits.

Pros:

- Reuses the standard package manifest.
- Avoids a new per-package metadata file.
- Keeps metadata close to package name, version, exports, dependencies, scripts, and package type.
- Supports README generation from one source file.
- Supports JSON Schema validation.
- Allows future Backstage, C4, Nx, OpenTelemetry, Kubernetes, and SPDX projections.
- Avoids adopting external schemas wholesale.
- Reduces translation burden.

Cons:

- The architecture object is project-specific.
- `package.json` becomes larger.
- Requires discipline to avoid vocabulary drift.
- Requires validation tooling and README generation tooling.

Risks:

- The schema may become too broad if future vocabulary groups are added without review.
- Field names may imply compatibility unless documented carefully.

### Option D: Use package.json plus manually maintained external descriptor files

Description:

Keep `package.json` for package metadata and maintain separate files for Backstage, diagrams, generated docs, and enforcement tags.

Pros:

- Each tool can use its native file format.
- Direct compatibility with some tools.

Cons:

- Multiple sources of truth.
- High drift risk.
- More review overhead.
- README and catalog descriptors can become inconsistent with package metadata.

Risks:

- Architecture governance becomes fragmented.
- Package metadata confidence declines.

## Decision

Use `package.json` as the package metadata source of truth.

Do not introduce `package.metadata.json`.

Do not manually maintain package README metadata.

Do not manually maintain Backstage, C4, Nx, OpenTelemetry, Kubernetes, or SPDX projection files as independent sources of truth.

Use existing standard `package.json` fields where they already fit.

Use one project-specific, namespaced architecture metadata object for fields not covered by standard package metadata.

The architecture metadata key will be:

```json
"architecture"
```

The `architecture` object must use vocabulary that is deliberately aligned with recognised external models where practical.

This ADR does not adopt those external schemas wholesale.

It adopts compatible nomenclature where the concept meaning matches.

A package README must be generated from `package.json`.

Generated views may later include:

```text
README.md
Backstage catalog descriptor
Nx project tags
C4 component inventory
OpenTelemetry resource naming hints
Kubernetes label hints
package inventory reports
supply-chain metadata hints
```

Those views must be projections from `package.json`, not separate sources of truth.

Initial example:

```json
{
  "name": "@scope/market-data-pricing",
  "version": "0.1.0",
  "private": true,
  "description": "Market data pricing application package.",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "architecture": {
    "schemaVersion": "1.0",
    "component": {
      "type": "library",
      "name": "market-data-pricing",
      "system": "market-data-platform",
      "domain": "market-data",
      "boundedContext": "market-data",
      "owner": "group:team/market-data"
    },
    "lifecycle": {
      "stage": "active",
      "role": "feature",
      "class": "active.feature",
      "catalogLifecycle": "production",
      "visibility": "internal",
      "supportLevel": "standard",
      "reviewCadence": "quarterly"
    },
    "governance": {
      "decisionRefs": [
        "ADR-0002",
        "ADR-0003",
        "ADR-0004",
        "ADR-0005"
      ],
      "semverPolicy": "internal-traceable",
      "changeControl": "owner-review",
      "promotionEligible": false
    },
    "runtime": {
      "production": true,
      "testOnly": false,
      "serviceName": "market-data-pricing",
      "serviceNamespace": "market-data",
      "deploymentEnvironments": [
        "local",
        "test",
        "staging",
        "production"
      ]
    },
    "boundaries": {
      "publicExportsOnly": true,
      "deepImportsAllowed": false,
      "allowedConsumers": [
        "feature",
        "application"
      ],
      "forbiddenConsumers": [
        "external"
      ]
    },
    "relations": {
      "dependsOn": [],
      "providesApis": [],
      "consumesApis": []
    },
    "tags": {
      "scope": "market-data",
      "type": "feature",
      "stage": "active",
      "role": "feature",
      "layer": "application"
    },
    "readme": {
      "generated": true,
      "summary": "Provides market-data pricing behaviour for application use cases.",
      "responsibilities": [
        "Own market-data pricing application logic",
        "Expose supported public exports",
        "Avoid infrastructure coupling"
      ],
      "nonResponsibilities": [
        "Do not own persistence adapters",
        "Do not own UI rendering"
      ],
      "usage": [
        "Import only through package public exports."
      ],
      "operationalNotes": [
        "Review quarterly while active."
      ]
    }
  }
}
```

Required standard `package.json` fields:

```text
name
version
description
private
type
exports
```

Required `architecture` field groups:

```text
architecture.schemaVersion
architecture.component
architecture.lifecycle
architecture.governance
architecture.runtime
architecture.boundaries
architecture.relations
architecture.tags
architecture.readme
```

Reserved future `architecture` field groups:

```text
architecture.security
architecture.data
architecture.operations
architecture.compliance
architecture.supplyChain
architecture.observability
architecture.deployment
```

The initial vocabulary alignment is:

| Field group | Vocabulary source | Intent |
|---|---|---|
| package.json standard fields | npm / Node.js package manifest | Package identity, version, description, module type, exports, dependencies |
| architecture.component | Backstage + C4 + ADR-0002 | Component, system, domain, bounded context, owner |
| architecture.lifecycle | ADR-0004 + Backstage projection | Source lifecycle model plus catalog-compatible lifecycle projection |
| architecture.governance | ADR process + package promotion governance | Decision references, semver policy, change control, promotion eligibility |
| architecture.runtime | OpenTelemetry-style runtime vocabulary | Runtime classification and service naming hints |
| architecture.boundaries | ADR-0001 + ADR-0003 + Nx-style enforcement | Public exports, deep imports, allowed consumers, forbidden consumers |
| architecture.relations | Backstage relationship vocabulary | dependsOn, providesApis, consumesApis |
| architecture.tags | Nx-style tag vocabulary | Generated enforcement tags and dependency constraints |
| architecture.readme | Generated documentation projection | Human-readable package documentation from metadata |
| architecture.deployment | Kubernetes-compatible vocabulary, future | Deployment label and workload projection |
| architecture.supplyChain | SPDX-compatible vocabulary, future | SBOM, licence, provenance, and supply-chain projection |

Allowed `architecture.component.type` values should initially include:

```text
application
library
service
api
worker
tool
test
documentation
```

Allowed `architecture.lifecycle.stage` values come from ADR-0004:

```text
experimental
candidate
active
stable
maintenance
external
deprecated
```

Allowed `architecture.lifecycle.role` values come from ADR-0004:

```text
feature
platform
contract
adapter
tooling
test
```

The lifecycle class must equal:

```text
architecture.lifecycle.stage + "." + architecture.lifecycle.role
```

Allowed `architecture.lifecycle.catalogLifecycle` values are projections for external catalog compatibility:

```text
experimental
production
deprecated
```

The projection rule is:

```text
experimental -> experimental
candidate -> experimental
active -> production
stable -> production
maintenance -> production
external -> production
deprecated -> deprecated
```

The catalog lifecycle projection must not replace ADR-0004 lifecycle stages.

Allowed visibility values:

```text
internal
releaseable
external
deprecated
```

Allowed semver policy values:

```text
none
internal-traceable
compatibility-reviewed
semver-required
external-governed
deprecated
```

Allowed support levels:

```text
experimental
standard
enhanced
maintenance
deprecated
unsupported
```

Allowed change-control values:

```text
none
owner-review
architecture-review
security-review
release-review
deprecation-review
```

Consumer values are free-form non-empty strings.

They should describe consumer roles or component types, not structural import locations. Using role/component-type labels (such as `application`, `feature`, `platform`, `domain`, `adapter`, `ui`, `tooling`, `test`, `external`) keeps consumer declarations aligned with ADR-0004 lifecycle roles and the `architecture.component.type` vocabulary. This makes consumer constraints machine-readable against the same vocabulary used elsewhere in package metadata.

Example consumer labels:

```text
application
feature
platform
domain
adapter
ui
tooling
test
external
```

Package authors may use other role labels where the role is not captured by the above list. Consumer values must be non-empty strings. The constraint is validated by schema; the vocabulary is governed by this ADR and the team's import boundary rules.

Generated package README output must include:

```text
package name
description
component type
system
domain
bounded context
owner
lifecycle stage
package role
lifecycle class
catalog lifecycle projection
visibility
semver policy
support level
review cadence
public exports
runtime classification
allowed consumers
forbidden consumers
dependency/API relations
generated tags
responsibilities
non-responsibilities
usage notes
operational notes
related ADRs
```

Validation tooling must eventually verify that:

```text
architecture.lifecycle.class == architecture.lifecycle.stage + "." + architecture.lifecycle.role
architecture.lifecycle.catalogLifecycle matches the defined projection rule
architecture.component.domain is listed in the context map/glossary
architecture.component.boundedContext is listed in the context map/glossary
architecture.lifecycle.stage is allowed by ADR-0004
architecture.lifecycle.role is allowed by ADR-0004
architecture.runtime.testOnly packages are not imported by production packages
architecture.boundaries.deepImportsAllowed is respected
package exports align with public export policy
deprecated packages are not used by new code
external packages have external-governed or semver-required policy
generated README content matches package.json metadata
generated Backstage, Nx, C4, OpenTelemetry, Kubernetes, or supply-chain projections do not become sources of truth
```

## Rationale

`package.json` is already the standard JavaScript package manifest.

npm documents `package.json` as the package metadata file for npm packages.

Node.js also uses `package.json` for package type, entry points, and exports.

Because the platform is expected to use JavaScript/TypeScript packages, the most standard local package metadata location is the existing package manifest.

A separate `package.metadata.json` file would add drift risk without enough benefit.

A manually maintained package README would also drift.

The correct model is:

```text
package.json
  source of truth

README.md
  generated human-readable projection

JSON Schema / validation tooling
  enforcement

Backstage / Nx / C4 / OpenTelemetry / Kubernetes / SPDX views
  generated or derived projections only
```

This keeps the package metadata complete enough for future lifecycle applications while avoiding unnecessary new files.

The architecture object is intentionally namespaced under one key so it does not collide with standard package fields.

The schema is designed for extension.

The chosen vocabulary groups deliberately align with established models:

```text
Backstage
  owner, domain, system, component, lifecycle projection, dependsOn, providesApis, consumesApis

DDD
  domain, boundedContext, context map, domain glossary

C4
  system and component language

Nx
  scope/type/stage/role/layer tags and dependency-boundary concepts

OpenTelemetry
  serviceName, serviceNamespace, deploymentEnvironments

JSON Schema
  schemaVersion, required fields, enum validation, additional property control

Kubernetes
  future deployment label projection

SPDX
  future supply-chain metadata projection
```

These external vocabularies are used for nomenclature alignment, not schema ownership.

ADR-0005 owns the package metadata schema for this product.

## Consequences

Positive:

- No separate package metadata file is used.
- The standard package manifest remains the source of truth.
- README content can be generated from package metadata.
- Future Backstage, Nx, C4, OpenTelemetry, Kubernetes, and supply-chain views can be generated or derived from the same source.
- Vocabulary is externally recognisable.
- Drift risk is reduced.
- CI can parse one package-local file.
- Import-boundary tooling can use package-local metadata.
- Package promotion decisions can use consistent fields.
- The metadata model remains extensible for future governance needs.

Negative:

- `package.json` becomes larger.
- The `architecture` object is project-specific.
- Validation tooling is required.
- README generation tooling is required.
- Projection tooling may be required later.
- Non-JavaScript packages may later need an equivalent manifest convention.
- Vocabulary alignment must be maintained deliberately as future ADRs are added.

Neutral / operational:

- Metadata changes should be reviewed like code changes.
- Generated README files should include a clear generated-file notice.
- Tooling should fail if generated README content is stale.
- Lifecycle class changes should trigger owner review.
- Domain values must remain aligned with the context map and glossary.
- The schema should be published as a JSON Schema for editor validation and CI validation.
- Existing standard fields such as `name`, `version`, `description`, `type`, `exports`, `dependencies`, `peerDependencies`, and `devDependencies` should not be duplicated inside the architecture object.
- External vocabulary projections must be generated from `package.json` metadata.

Future consequences:

- A later implementation action should create the JSON Schema for `package.json` architecture metadata.
- A later implementation action should create README generation tooling.
- A later implementation action should create derived Backstage/Nx/C4 projection tooling only if needed.
- A later ADR should define lifecycle transition rules.
- A later ADR should define package promotion criteria.
- A later ADR should define affected-package CI behaviour.
- A later ADR should define import-boundary enforcement.

## AI-assistance record

AI used: Yes

- Tool/model:
  - ChatGPT

- Assistance scope:
  - Drafting, vocabulary alignment, option comparison, schema framing, and consistency review.

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

- npm documents `package.json` as the package metadata file for npm packages.
- Node.js uses package `package.json` fields for module type, entry points, and exports.
- Backstage provides established catalog vocabulary for component, system, domain, owner, lifecycle, APIs, and relationships.
- C4 provides established architecture vocabulary for software system, container, component, and code views.
- Nx provides established monorepo boundary vocabulary using project tags and dependency constraints.
- OpenTelemetry provides established runtime and resource semantic convention vocabulary.
- JSON Schema provides validation vocabulary for required fields, enums, and additional properties.
- Kubernetes recommended labels provide deployment metadata vocabulary for future projections.
- SPDX provides software supply-chain vocabulary for future projections.
- ADR-0004 requires package domain, lifecycle stage, package role, lifecycle class, and owner.
- ADR-0003 requires promotion-ready package boundaries.
- ADR-0002 provides domain values through context map and glossary.
- The action register identifies package metadata format as the next required decision.

Further validation required:

- Create sample `package.json` metadata for initial packages.
- Create JSON Schema validation for the architecture metadata object.
- Generate README output from package metadata.
- Confirm generated README output is stakeholder-readable.
- Confirm metadata can support affected CI.
- Confirm metadata can support import-boundary enforcement.
- Confirm metadata can support future package promotion decisions.
- Confirm the vocabulary remains consistent across ADR-0001 through ADR-0005 after review.

## Impacted areas

- Architecture:
  - Defines machine-readable package classification for modular boundaries.
  - Establishes package metadata vocabulary alignment across ADRs.

- Data:
  - Data packages must declare domain, bounded context, lifecycle, owner, visibility, runtime use, and semver policy.
  - Future data metadata should be added under a stable `architecture.data` group.

- API:
  - Contract packages must declare lifecycle, visibility, public API rules, exports, relations, and semver policy.
  - API relationships should align with Backstage-style `providesApis` and `consumesApis` where practical.

- Security:
  - Security-sensitive packages can be identified by ownership, visibility, runtime use, support level, and future security metadata.
  - Future security metadata should be added under a stable `architecture.security` group.

- Operations:
  - Support level and review cadence help identify operational expectations.
  - Runtime metadata should align with OpenTelemetry-style service naming where practical.
  - Future operations metadata should be added under a stable `architecture.operations` group.

- Testing:
  - Test-only metadata helps prevent production runtime dependencies on test packages.

- Delivery:
  - Affected CI and release checks can use package metadata.
  - Nx-style tags may be generated from package metadata.

- UX:
  - Shared UI and design-system packages can advertise stability and support expectations.

- Documentation:
  - Package README files must be generated from package metadata.
  - README generation should fail if required source metadata is missing.

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

- Package metadata and package manifest references:
  - npm package.json documentation.
  - Node.js package documentation.

- Catalog, architecture, enforcement, runtime, validation, deployment, and supply-chain vocabulary references:
  - Backstage Software Catalog descriptor format.
  - Domain-Driven Design bounded-context vocabulary.
  - C4 model vocabulary.
  - Nx module-boundary and tag vocabulary.
  - OpenTelemetry semantic conventions.
  - JSON Schema validation vocabulary.
  - Kubernetes recommended labels.
  - SPDX software supply-chain vocabulary.

- Accepted ADRs:
  - docs/adr/0001-use-modular-hexagonal-architecture.md
  - docs/adr/0002-model-the-platform-around-bounded-contexts.md
  - docs/adr/0003-use-a-modular-monorepo-with-promotion-ready-package-boundaries.md
  - docs/adr/0004-define-package-lifecycle-classes.md

- ADR process:
  - docs/adr/README.md
  - docs/adr/0000-template.md
  - docs/adr/ACTION-REGISTER.md

- Related future ADRs:
  - Package lifecycle transition rules.
  - Package promotion criteria and review process.
  - Affected-package CI workflow.
  - Import-boundary enforcement.
  - Build/test orchestration tooling.

## Notes

This ADR does not choose README generation tooling.

This ADR does not choose the final JSON Schema file location.

This ADR does not finalise allowed domain values.

This ADR does not define lifecycle transition rules.

This ADR does not define package promotion criteria.

This ADR does not adopt Backstage, C4, Nx, OpenTelemetry, Kubernetes, or SPDX schemas wholesale.

This ADR defines the package metadata vocabulary and format required to make ADR-0002, ADR-0003, and ADR-0004 enforceable while avoiding new per-package metadata assets and avoiding future translation-heavy vocabulary mappings.
