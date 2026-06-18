# ADR-0006 lifecycle evidence — deprecation of nine superseded package scaffolds

**Date:** 2026-06-18 · **Action:** ADR-ACT-0289 (ADR-0006 package lifecycle; split out from ADR-ACT-0288 which tracks the ADR-0011 tooling) · **Transition:** `active`/`stable` → `deprecated` · **Removal review (deprecated → removed):** 2026-12-18 (separate governed change, not executed here)

> Filename retains the `adr-act-0288` slug for history; the authoritative tracking action is now **ADR-ACT-0289**.

## Summary

Nine `@platform/*` runtime port-scaffolding packages are transitioned to `deprecated`. All nine have **zero real source consumers** (verified by `validate-source-imports` over `apps/` + `packages/`, excluding this tool's test fixtures and generated files) and are **not** removed — ADR-0006 allows deprecated packages to remain indefinitely; physical removal is gated on the 2026-12-18 review.

The replacement model is **not uniform** — it is classified per package below. Most capability packages (search/profile/notifications/worker/queue) are superseded by application-local implementations in `apps/platform-api`; authz packages by existing platform packages; and two are scaffolds/helpers with no port-style replacement at all. The earlier claim that "all nine were superseded by application-local ports" overstated it and is corrected here.

Metadata transition applied to each: `lifecycle.stage=deprecated`, `lifecycle.class=deprecated.<role>`, `lifecycle.catalogLifecycle=deprecated`, `lifecycle.visibility=deprecated`, `lifecycle.supportLevel=deprecated`, `governance.semverPolicy=deprecated`, `governance.changeControl=deprecation-review`, `governance.promotionEligible=false`, `decisionRefs += ADR-0006`, and `tags.stage`/`tags.role` reconciled to the lifecycle projection. Generated READMEs lead with a DEPRECATED banner and deprecation-only usage guidance (no import advertising). False `relations.dependsOn` edges cleared.

New-usage prevention: the metadata-driven `no-import-from-deprecated` rule (`validate-source-imports`) fails any new source import of a `lifecycle.stage=deprecated` package; documented exceptions live in `docs/architecture/import-boundary-rules.json` → `deprecatedImportExceptions` (currently empty).

## Per-package records

| Package | from → to | consumers | TypeScript project reference | replacement classification | replacement |
| --- | --- | --- | --- | --- | --- |
| domain-core | stable.platform → deprecated.platform | 0 | no | generic helper replaced by standard-library primitives | `node:crypto` randomUUID + `Date.toISOString` |
| access-control | stable.platform → deprecated.platform | 0 | no | superseded by an existing package capability | `@platform/authorisation-runtime` + `@platform/adapters-keycloak` |
| feature-workflow | active.feature → deprecated.feature | 0 | no | speculative scaffold requiring no replacement | — (never wired) |
| profile-configuration | stable.platform → deprecated.platform | 0 | no | superseded by application-local port and adapter | `apps/platform-api/src/usecases/profile.ts` + `ports/profile-repository.ts` |
| security-auth | active.platform → deprecated.platform | 0 | no | superseded by an existing package capability | `@platform/authorisation-runtime` + `@platform/adapters-keycloak` |
| queue-runtime | active.platform → deprecated.platform | 0 | yes — retained while deprecated so the package continues to compile until removal | superseded by application-local port and adapter | `apps/platform-api` webhook delivery queue (migration 020) + `server/worker-registry.ts` |
| search-runtime | active.platform → deprecated.platform | 0 | yes — retained while deprecated so the package continues to compile until removal | superseded by application-local port and adapter | `apps/platform-api/src/usecases/search.ts` + `adapters/postgres-search-repository.ts` |
| notification-runtime | active.platform → deprecated.platform | 0 | yes — retained while deprecated so the package continues to compile until removal | superseded by application-local port and adapter | `apps/platform-api/src/usecases/notifications.ts` + `adapters/postgres-notification-repository.ts` |
| worker-runtime | active.platform → deprecated.platform | 0 | yes — retained while deprecated so the package continues to compile until removal | superseded by application-local port and adapter | `apps/platform-api/src/server/worker-registry.ts` + `usecases/webhook-worker.ts` |

Only `notification-runtime`, `queue-runtime`, `search-runtime`, and `worker-runtime` appear in `packages/tsconfig.packages.json` (`{ "path": "./<pkg>" }`); the other five are not project-referenced. All project references are **retained** while deprecated and removed only in the removal phase.

## False `dependsOn` edges also cleared in live packages

These active packages declared (but never imported) a now-deprecated package; the false `architecture.relations.dependsOn` edges were removed (zero source imports verified):

- `@platform/api-runtime`, `@platform/adapters-keycloak`, `@platform/session-runtime` → removed `@platform/security-auth`
- `@platform/contracts-graphql` → removed `@platform/access-control`, `@platform/profile-configuration`
- `apps/react-enterprise-app` → removed `@platform/access-control`, `@platform/feature-workflow`

## Hexagonal invariants (verified for the application-local replacements)

For search / notifications / profile / worker / queue, the canonical implementation is an application-local port under `apps/platform-api/src/ports/` with a postgres adapter under `adapters/`, wired in server composition — a valid hexagonal boundary because platform-api is the only application core that owns the capability. usecases import ports (not adapters); ports carry no DB/HTTP/SDK types; a future provider swap implements the same inward-facing port. No package extraction is justified. (domain-core and feature-workflow are explicitly NOT port replacements — see the classification column.)

## Verification

- `validate-package-metadata`: 51/51 pass; `validateTagProjection` now enforces `tags.stage/role === lifecycle.stage/role`.
- `validate-source-imports`: live tree clean (`no-import-from-deprecated` 0 violations); unit tests prove the rule.
- This evidence's facts are machine-checked by `scripts/evidence/tests/deprecation-evidence-facts.test.mjs` (package dirs exist + are `deprecated`; referenced replacement files exist; exactly the four tsconfig-referenced packages are present in `packages/tsconfig.packages.json`).
- `orchestrator all --strict`: exit 0. Linkage: ADR-ACT-0289 (← split from ADR-ACT-0288).

## Not done here (gated to the removal phase, ADR-0006 §"deprecated to removed", review 2026-12-18)

Loader-alias removal, package-specific import-boundary-row removal, **tsconfig project-reference removal**, package-directory deletion, dependency-manifest cleanup, regenerated inventory/CODEMAPS — all deferred to a later change after the review confirms no supported usage remains.
