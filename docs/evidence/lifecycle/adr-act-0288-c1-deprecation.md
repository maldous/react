# ADR-0006 lifecycle evidence — ADR-ACT-0288 C1 deprecation batch

**Date:** 2026-06-18 · **Transition:** `active`/`stable` → `deprecated` (ADR-0006 §"active or stable to deprecated") · **Action:** ADR-ACT-0288 (Workstream C1) · **Removal review (deprecated → removed):** 2026-12-18 (separate governed change, not executed here)

## Summary

Nine `@platform/*` runtime port-scaffolding packages are transitioned to `deprecated`. All nine have **zero real source consumers** (verified by `validate-source-imports` over `apps/` + `packages/`, excluding this tool's test fixtures and generated files) and are superseded by application-local hexagonal ports in `apps/platform-api`. They are **not removed** — ADR-0006 allows deprecated packages to remain indefinitely; physical removal is gated on the 2026-12-18 review.

Metadata transition applied to each (ADR-0006 §"Metadata changes required by transition" + schema conditionals): `lifecycle.stage=deprecated`, `lifecycle.class=deprecated.<role>`, `lifecycle.catalogLifecycle=deprecated`, `lifecycle.visibility=deprecated`, `lifecycle.supportLevel=deprecated`, `governance.semverPolicy=deprecated`, `governance.changeControl=deprecation-review`, `governance.promotionEligible=false`, `decisionRefs += ADR-0006`. Generated READMEs regenerated (lead with a DEPRECATED notice + replacement + no-new-usage + removal review date). False `architecture.relations.dependsOn` edges cleared.

New-usage prevention: a metadata-driven import-boundary rule (`no-import-from-deprecated`, `validate-source-imports`) fails any new source import of a `lifecycle.stage=deprecated` package; narrow documented exceptions live in `docs/architecture/import-boundary-rules.json` → `deprecatedImportExceptions` (currently empty — none warranted).

## Per-package records

| Package | from → to | consumers (excl. fixtures/generated) | false `dependsOn` cleared | loader alias | tsconfig ref | boundary rows | normative ADR refs | replacement | removal review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| @platform/domain-core | stable.platform → deprecated.platform | 0 | — | yes (kept until removal) | none | 9 | 1 | none required — use `node:crypto` randomUUID + `Date.toISOString` | 2026-12-18 |
| @platform/access-control | stable.platform → deprecated.platform | 0 | domain-core, profile-configuration | yes | none | 8 | 5 | platform-api `authorisation-runtime` + `adapters-keycloak` | 2026-12-18 |
| @platform/feature-workflow | active.feature → deprecated.feature | 0 | domain-core, profile-configuration, access-control, contracts-graphql, contracts-analytics | yes | none | 9 | 1 | none required — speculative workflow engine, never wired | 2026-12-18 |
| @platform/profile-configuration | stable.platform → deprecated.platform | 0 | domain-core | yes | none | 7 | 1 | platform-api `usecases/profile.ts` + `ports/profile-repository.ts` | 2026-12-18 |
| @platform/security-auth | active.platform → deprecated.platform | 0 | — | yes | none | 5 | 1 | `authorisation-runtime` + `adapters-keycloak` | 2026-12-18 |
| @platform/queue-runtime | active.platform → deprecated.platform | 0 | — | yes | none | 4 | 0 | platform-api webhook delivery queue (migration 020) + `server/worker-registry.ts` | 2026-12-18 |
| @platform/search-runtime | active.platform → deprecated.platform | 0 | — | yes | none | 1 | 0 | platform-api `usecases/search.ts` + `adapters/postgres-search-repository.ts` | 2026-12-18 |
| @platform/notification-runtime | active.platform → deprecated.platform | 0 | — | yes | none | 1 | 0 | platform-api `usecases/notifications.ts` + `adapters/postgres-notification-repository.ts` | 2026-12-18 |
| @platform/worker-runtime | active.platform → deprecated.platform | 0 | queue-runtime, config-runtime, observability, audit-events | yes | none | 5 | 1 | platform-api `server/worker-registry.ts` + `usecases/webhook-worker.ts` | 2026-12-18 |

## False `dependsOn` edges also cleared in live packages

These active packages declared (but never imported) a now-deprecated package; the false `architecture.relations.dependsOn` edges were removed (zero source imports verified):

- `@platform/api-runtime`, `@platform/adapters-keycloak`, `@platform/session-runtime` → removed `@platform/security-auth`
- `@platform/contracts-graphql` → removed `@platform/access-control`, `@platform/profile-configuration`
- `apps/react-enterprise-app` → removed `@platform/access-control`, `@platform/feature-workflow`

## Hexagonal invariants (verified for the delivered replacements)

For search / notifications / profile / worker / queue / authz, the canonical implementation is an **application-local port** under `apps/platform-api/src/ports/` with a postgres adapter under `adapters/`, wired in server composition — a valid hexagonal boundary because platform-api is the only application core that owns the capability. usecases import ports (not adapters); ports carry no DB/HTTP/SDK types; a future provider swap implements the same inward-facing port. No package extraction is justified (no second consumer, no independent lifecycle/ownership, no ADR requiring a package-level contract).

## Verification

- `validate-package-metadata`: 51/51 pass (deprecated metadata schema-conformant).
- `validate-source-imports`: live tree clean (`no-import-from-deprecated` 0 violations — confirms zero real consumers); unit tests prove the rule (new deprecated import fails, active passes, narrow exception passes, self-reference passes).
- `orchestrator all --strict`: exit 0 (incl. `validate-lifecycle-evidence`, `generate-package-readmes` check, `generate-lifecycle-reports`).
- Linkage: ADR-ACT-0288.

## Not done here (gated to the removal phase, ADR-0006 §"deprecated to removed")

Loader-alias removal, package-specific import-boundary-row removal, tsconfig reference removal, package-directory deletion, and dependency-manifest cleanup are **removal-phase** tasks — deferred to a later change after this deprecation commit is reviewed and the 2026-12-18 review confirms no supported usage remains.
