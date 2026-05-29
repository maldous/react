# Package Metadata Vocabulary Validation

**Action:** ADR-ACT-0037  
**ADR:** ADR-0005 (Define package metadata vocabulary and format)  
**Date:** 2026-05-29

## Purpose

Validate that the vocabulary used in `docs/schemas/package-json-architecture.schema.json` is consistent with the reference language from Backstage, DDD, C4, Nx, OpenTelemetry, JSON Schema, Kubernetes, and SPDX. Identify gaps, conflicts, or aliases. Confirm the schema as the canonical architecture vocabulary for this repository.

---

## Vocabulary under review

Key enums and structural terms from the schema:

| Field | Values |
| --- | --- |
| `component.type` | `application`, `library`, `service`, `api`, `worker`, `tool`, `test`, `documentation` |
| `lifecycle.stage` | `experimental`, `candidate`, `active`, `stable`, `maintenance`, `external`, `deprecated` |
| `lifecycle.role` | `feature`, `platform`, `contract`, `adapter`, `tooling`, `test` |
| `lifecycle.catalogLifecycle` | `experimental`, `production`, `deprecated` |
| `lifecycle.visibility` | `internal`, `releaseable`, `external`, `deprecated` |
| `lifecycle.supportLevel` | `experimental`, `standard`, `enhanced`, `maintenance`, `deprecated`, `unsupported` |
| `governance.semverPolicy` | `none`, `internal-traceable`, `compatibility-reviewed`, `semver-required`, `external-governed`, `deprecated` |
| `tags.layer` | `domain`, `application`, `app`, `adapter`, `ui`, `infrastructure`, `tooling`, `test`, `documentation`, `contract`, `feature`, `platform`, `runtime` |
| `component.domain` | free-string (bounded-context name) |
| `component.boundedContext` | free-string |

---

## Alignment by reference system

### Backstage Software Catalog

Backstage uses `kind: Component` with `spec.type` values: `service`, `website`, `library`. Our schema extends this with `application`, `api`, `worker`, `tool`, `test`, `documentation` — all additive, no conflicts.

Backstage `spec.lifecycle` maps to `experimental`, `production`, `deprecated`. Our `catalogLifecycle` field mirrors this exactly and is used to populate Backstage exports. ✓ **Aligned.**

Backstage `spec.owner` is a free-string team reference. Our schema has `component.owner` as a non-empty string. ✓ **Aligned.**

Backstage `spec.system` maps to our `component.system`. ✓ **Aligned.**

**Gap:** Backstage has `spec.subcomponentOf` and `spec.dependsOn` relationship fields. We do not use these — our boundaries use `import-boundary-rules.json` instead. This is intentional and documented in ADR-0003. No vocabulary conflict.

---

### Domain-Driven Design (DDD)

DDD uses: bounded context, domain, aggregate, entity, value object, domain event, repository, service.

Our schema uses `boundedContext` and `domain` as first-class fields at the component level. ✓ **Aligned with DDD terminology.**

Our `lifecycle.role` values (`feature`, `platform`, `contract`, `adapter`) map to DDD patterns:

- `feature` → application service / use-case
- `platform` → shared kernel / supporting domain infrastructure
- `contract` → anti-corruption layer interface / published language
- `adapter` → port-and-adapter (hexagonal) — explicit ADR-0001 reference

**Gap:** DDD uses "aggregate root" — not present in our vocabulary as we are pre-schema growth. No conflict; additive if needed.

✓ **Core DDD boundary vocabulary is present and consistently used.**

---

### C4 Model

C4 levels: System Context, Container, Component, Code.

Our `component.type` values map to C4 containers: `application` and `service` are C4 containers; `library` is a C4 component. Our `component.system` maps to the C4 System.

Our `tags.layer` values (`domain`, `application`, `adapter`, `ui`, `infrastructure`) align with the standard C4 container decomposition in hexagonal architecture.

✓ **C4 vocabulary is present at the right level of abstraction.**

---

### Nx Module Boundaries and Tags

Nx uses tags on projects for boundary enforcement (e.g. `type:feature`, `scope:shared`). Our `tags.type`, `tags.role`, and `tags.layer` are the structural equivalents and are used by `validate-source-imports` via `import-boundary-rules.json`.

Nx tag conventions: `type:app`, `type:lib`, `scope:*`, `layer:*`. Our schema uses `type` and `layer` with domain-specific values. No collision — our tags are a strict superset of Nx's minimal tag vocabulary.

✓ **Aligned. Our tag schema is richer than Nx defaults and fully subsumes them.**

---

### OpenTelemetry

OTel uses service name, service version, service namespace, deployment environment. Our schema has:

- `component.system` → OTel `service.namespace`
- `component.name` → OTel `service.name`
- `runtime.deploymentEnvironments` → OTel `deployment.environment` (values: `local`, `development`, `test`, `ci`, `staging`, `production`)

OTel `deployment.environment` values are not standardised — our set is conventional and compatible.

✓ **Aligned for observability metadata generation.**

---

### JSON Schema

Our schema is written in JSON Schema draft-07 compatible syntax. Field names, `$ref`, `$defs`, `additionalProperties`, `required`, `enum`, `const`, `allOf`, `if`/`then`/`else` are used correctly.

`nonEmptyString` uses `minLength: 1` pattern — correct JSON Schema idiom.

✓ **Technically correct JSON Schema vocabulary throughout.**

---

### Kubernetes

K8s uses labels and annotations with `key: value` pairs. Our `component.tags` object provides a structural equivalent. Our lifecycle and governance enums could map to K8s annotation values without modification.

K8s does not govern package-level metadata. No vocabulary conflict at this level.

✓ **No conflict. Compatible if K8s metadata generation is added later.**

---

### SPDX

SPDX governs software supply-chain metadata: package name, version, license, checksum, supplier, originator.

Our schema has `governance.semverPolicy` and `governance.changeControl` which govern versioning discipline but do not duplicate SPDX fields. SPDX data is generated separately via `npm run sbom:generate` (CycloneDX format, tracked in ADR-ACT-0090).

✓ **No vocabulary conflict. SPDX coverage is via SBOM, not package.json architecture metadata.**

---

## Summary

| Reference system | Alignment | Notes |
| --- | --- | --- |
| Backstage | ✓ Aligned | `catalogLifecycle` mirrors Backstage lifecycle exactly |
| DDD | ✓ Aligned | `boundedContext`, `domain`, `role` use canonical DDD terms |
| C4 | ✓ Aligned | Layer/type vocabulary maps to C4 container decomposition |
| Nx | ✓ Aligned | Tag schema is a superset of Nx tag conventions |
| OpenTelemetry | ✓ Aligned | `system`, `name`, `deploymentEnvironments` map to OTel semantic conventions |
| JSON Schema | ✓ Correct | Schema uses correct draft-07 idioms throughout |
| Kubernetes | ✓ Compatible | No conflict; `tags` is K8s-annotation-compatible |
| SPDX | ✓ Separated | SBOM generation covers SPDX; no schema vocabulary conflict |

**Verdict:** The package metadata vocabulary in `docs/schemas/package-json-architecture.schema.json` is consistent with all eight reference systems. No term conflicts or aliasing errors were found. The schema can be formally accepted as the canonical architecture vocabulary for ADR-0005.
