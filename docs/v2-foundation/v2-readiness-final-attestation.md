# V2 Readiness Final Attestation

Status: READY FOR V2 CUT

## Scope Audited

This attestation covers the V2 semantic foundation artefacts under `docs/v2-foundation/`, the live V1 capability closure, the V1 proof inventory, the V2 readiness validator rules, and the source-derived platform event names discovered from `apps/platform-api/src`, `apps/platform-api/scripts`, and `apps/platform-api/tests`.

Audited artefacts:

- `v1-capability-closure.json`
- `environment-capability-matrix.json`
- `cross-capability-interactions.json`
- `event-semantics.json`
- `operational-semantics.json`
- `semantic-source-of-truth-transition.md`
- `semantic-source-of-truth-transition.json`
- `environment-readiness-gates.json`
- `ui-capability-model.json`
- `capability-proof-definition.json`
- `v1-test-proof-inventory.json`
- `zero-gap-reconciliation.json`
- `tools/v2-readiness/src/rules/`

## Canonical Source Model

V1-final is historical evidence after the cut. The canonical post-cut semantic source of truth is the V2 foundation artefact set: capability definitions, state machines, permissions, errors, UI contracts, proof definitions, event semantics, environment semantics, operational semantics, cross-capability interactions, environment readiness gates, and source-of-truth transition policy.

V2 code is the implementation of those semantic artefacts. Validators enforce drift control. Proofs are evidence, not substitutes for semantic definition.

## Why The Semantics Are Real

The environment matrix now defines all four environments for every delivered capability and records provider class, data class, tenant-data policy, mock/sandbox/live-provider policy, secret/network policy, required proof level, proof evidence, smoke checks, seed/destructive-proof policy, promotion and rollback gates, observability, and cost/security/external-dependency risk.

The event catalogue separates canonical events from fixture/test-only names. Generic names such as `x`, `t`, `boom`, `thing.created`, `ok.event`, `boom.event`, `no.handler`, and `platform.test` are classified as test-only, include source/rationale, and are excluded from product readiness. Canonical events define category, owner, producer, consumers, bounded schema, payload contract, idempotency, ordering, retry/DLQ, retention, privacy, tenant isolation, audit relationship, source refs, proof, environment behaviour, and breaking-change policy.

Operational semantics are capability-specific. Each delivered capability records deployment, config, migration, rollback, backup/restore relationship, partial failure, degraded mode, recovery, metrics, logs, traces, alerts, runbook, incident class, data/security risk, tenant impact, operator action, and proof references.

Cross-capability interactions are explicit and source-evidenced. They define producer/consumer ownership, interaction type, shared contract, data/control boundaries, failure, ordering, retry/idempotency, consistency, transaction boundary, compensation, environment behaviour, security/audit boundaries, proof references, and source evidence.

The proof inventory now classifies every proof with level, rationale, capabilities/facets proven, environment, provider class, live substrate use, destructive/prod-safe flags, source command, script path where applicable, and expected failure mode.

## Validator Enforcement

The validator enforces semantic quality through R23-R29:

- R23 rejects under-classified proof inventory and unsafe destructive/prod-safe proof claims.
- R24 rejects incomplete environment policy, prod mocks, prod destructive proofs, paid/live-only test requirements, missing gates, and proof references that do not map to evidence.
- R25 rejects missing or weak cross-capability interactions and invalid capability/proof references.
- R26 rejects fixture event leakage, generic event names without test-only isolation, arbitrary canonical payloads, missing source refs, and missing privacy/tenant/environment/versioning policy.
- R27 rejects generic operational rows and missing provider/database/tenant-data operations semantics.
- R28 rejects source-of-truth drift policy gaps and incomplete post-V2 change coupling.
- R29 rejects missing or contradictory dev/test/staging/prod readiness gates.

## Environment Readiness

Dev is for fast local discovery with declared mocks only and local/composed providers preferred.

Test is deterministic automated proof with disposable data, fixed fixtures, no paid/live-only provider requirement, and semantic/state/permission proof coverage.

Staging is production-shape rehearsal with no mocks, sandbox external providers, real secret-manager pattern, migration rehearsal, rollback rehearsal, and observability.

Prod is real tenant operation only. It forbids mocks, seed data, fixture event emission, destructive proofs, and test data insertion. Prod proof is limited to current health/readiness and synthetic non-destructive smoke journeys because destructive proof belongs in dev/test/staging and would put tenant data at risk.

## Intentionally Excluded

Fixture/test-only events remain in the event catalogue only to document and isolate event-substrate proof names. They are not product/platform readiness semantics and cannot be generated into UI behaviour.

V1 remains available only as historical evidence and for evidence correction. It is not a live post-cut semantic authority.

## External-Limited Areas

External integrations remain environment-limited: dev/test use hermetic or composed substitutes where possible, staging uses sandbox provider contracts, and prod uses live providers only for tenant operation and non-destructive health/smoke checks. These limits are declared in `environment-capability-matrix.json`, `operational-semantics.json`, and `environment-readiness-gates.json`.

## Verification Record

The following commands were required by the objective and passed locally in this work session:

- `npm run v2:readiness -- --strict`: GREEN, zero findings, cut ready.
- `npm run v2:readiness -- --json`: `ok=true`, `cutReady=true`, `totalRules=29`, zero findings.
- `npm test -- tools/v2-readiness`: 88 passing tests, zero failures.
- `make all`: passed; dev, test, staging, and prod all reached FULL confidence. Stage evidence was written under `docs/evidence/stages/`.

Whitespace checks are required immediately before commit:

- `git diff --check`
- `git diff --cached --check`

## Post-Cut Rule

After the V2 cut, behavioural changes must update capability definition, contracts, permissions, validation, errors, events, operational semantics, environment semantics, UI semantics, proofs, and validator rules when the semantic class changes. Code-only behaviour changes, generated UI invention, event emission without event semantics, new providers without environment/operational semantics, and new capabilities without proof/readiness semantics are forbidden drift.

V2 can now be cut because V1 proves the platform, semantic artefacts define the platform, validators enforce the platform, V2 extracts the platform, and AI UI generation has explicit semantic inputs rather than permission to invent behaviour.
