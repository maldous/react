# tools/v2-readiness

Read-only validator that proves the `docs/v2-foundation/` planning closure is **semantically
self-consistent** (not merely count-reconciled) and reports the outstanding branch-cut blockers. It
writes nothing. Spec: `docs/v2-foundation/v2-readiness-validator-spec.md`.

```bash
npm run v2:readiness        # human report, exit 1 while blockers remain
npm run v2:readiness:json   # machine report
npm run v2:formal-assurance # regenerate formal graph/report artefacts + attestation
npm run v2:usf-assurance    # regenerate Universal Service Foundation assurance graphs/reports
node tools/v2-readiness/src/index.mjs --strict --repo . --pinned <freeze-sha>
```

Exit `0` only when every rule passes — i.e. the artefacts are honest AND there are zero
`requires-v1-completion` capabilities, zero deprecated packages pending removal, and no open package
decision. Until then it is RED, which is the honest cut-gate state (runbook §0).

## Rules

- **R1 placeholder** — no `<undefined>`/`TBD`/`TODO`/`must decide`/`candidate`/`not integrated` in
  closure-claim artefacts; pinned commit resolved. `{{PINNED_V1_COMMIT}}` is the sanctioned parameter.
- **R2 capability-integrity** — `delivered-and-proven` forbidden with missing/partial route (no
  `acceptablePartialRoute`), missing contract, undecided permission/readiness, unproven proof, or a
  "must close before V2 cut" `openAction`; every `requires-v1-completion` has a `completionAction`.
- **R3 zero-gap-honesty** — no affirmative "zero gaps" claim while gaps remain (honest negations OK).
- **R4 vocabulary** — dispositions / migrationTypes / statuses confined to the canonical sets.
- **R5 count-buckets** — reconciliation buckets equal the recomputed counts and use path-map names
  (no collapsed `reuse 1239` alias).
- **R6 package-removal** — `delete-after-proof` carries `v2Path:null`; no removed package survives in
  the target tree; every deprecated-set package file is `delete-after-proof`.
- **R7 soft-mapping** — `delete-after-proof` carries a real `deletionCondition`; package files carry
  `decisionRefs` (no clearing metadata/README as "no runtime behaviour" without a final decision).
- **R8 runbook-tooling** — the runbook's tool dependency is implemented + scripted + the audited
  commit is recorded.
- **R9 branch-cut-blocker** — fail-closed gate: every `requires-v1-completion`, every deprecated
  package whose **live** removal status still blocks (determined from the current repo + removal
  evidence at `docs/evidence/lifecycle/removal/<pkg>.md`, NOT from path-map membership), and every
  open decision.
- **R10 file-coverage** — independent bijection: `git ls-tree`(audited) ⇆ inventory ⇆ shards ⇆ path-map.
- **R11 command-coverage** — live Make targets + npm scripts ⇆ command catalogue + map; no
  missing/stale/duplicate; `merge`/`retire` carry a `retireReason`.
- **R12 test-coverage** — live test files inventoried; inventory paths resolve; no dangling map
  records; `retire` justified.
- **R13 decision-governance** — every V2 decision Accepted + has lineage; referenced V1 ADRs/actions
  exist; `requires-v1-completion` `decisionRef`s resolve.
- **R14 foundation** — foundation artefacts present/shaped; governed contract roots present
  in the tree.
- **R15 app-path** — tree/maps/contracts/runbook agree on the app roots (`apps/platform-api` +
  `apps/web`); `apps/api` appears nowhere.
- **R16 services** — compose services reconcile with the service/clickthrough/SSO matrix.
- **R17 migrations** — on-disk SQL migrations reconcile with the data-and-migration plan, including
  migration intent and backup/restore decisions for tenant-data services.
- **R18 environment-config** — live env/config consumption reconciles with generated config
  catalogues; unsafe prod/staging defaults and mock/destructive flags fail closed.
- **R19 executable-assets** — shell/node/Terraform/Playwright assets are mapped, inventoried, and
  attached to resolving command targets.
- **R20 harness-semantics** — Semantic Reference Harness definitions are internally consistent and
  backed by the generic harness.
- **R21 v1c17-observability** — observability dashboards and proof scripts exist for the V1C-17
  substrate.
- **R22 semantic-completeness** — the six mandatory semantic foundation assets exist and every
  `delivered-and-proven` capability carries `semanticCompleteness.status:"complete"` with lifecycle,
  state model, permissions, contracts, validation, error model, audit model, readiness model, proof,
  and UI semantic definition.
- **R23 proof-classification** — every proof inventory entry declares proof level, rationale,
  capabilities and facets proven, environment, provider class, live-substrate/destructive/prod-safe
  flags, source command, and expected failure mode. Runtime proof scripts must be represented.
- **R24 environment-semantics** — every delivered capability has dev/test/staging/prod provider
  semantics, provider class, data class, tenant-data policy, secret/network policy, proof level,
  proof refs, smoke checks, promotion/rollback gates, risk, and prod mock/destructive-proof closure.
- **R25 cross-capability-semantics** — mandatory cross-capability interaction contracts define
  ownership, consistency, transaction, compensation, security/audit, source evidence, and proof
  semantics.
- **R26 event-semantics** — emitted platform events are owned, schema-versioned, idempotent where
  mutating, classified by category, isolate fixture/test-only events, and define bounded payload,
  privacy, tenant isolation, environment behaviour, source refs, and breaking-change policy.
- **R27 operational-semantics** — delivered capabilities define deploy, migration/rollback,
  backup/restore, degraded, recovery, observability, runbook, incident, tenant impact, operator
  action, and proof semantics with generic/template text rejected.
- **R28 semantic-source-transition** — V1-final becomes historical evidence after the cut and V2
  semantic artefacts become the source of truth for code and behaviour changes, including required
  change coupling and forbidden drift cases.
- **R29 environment-readiness-gates** — dev/test/staging/prod gates define purpose, commands, proof
  levels, provider/mocking policy, staging rehearsal, prod smoke/readiness, and contradictions with
  the environment-capability matrix are rejected.
- **R30 graph-integrity** — the formal semantic graph has stable nodes and explicit edges, with no
  orphan nodes, dangling references, invalid cycles, missing ownership chains, or duplicate semantic
  identities.
- **R31 state-machine-soundness** — every formal lifecycle state machine has reachable states, valid
  transitions, explicit terminal states, and no dead states or impossible bypasses.
- **R32 traceability-closure** — capabilities, proofs, events, environments, interactions, and UI
  semantics form a closed traceability matrix, including explicit absence records where a capability
  has no source-derived event or named cross-capability interaction.
- **R33 environment-completeness** — the Capability x Environment matrix is complete and enforces dev
  local execution, test deterministic proof, staging production-shape rehearsal, and prod
  non-destructive health validation.
- **R34 constraint-satisfaction** — semantic implications are checked as constraints, including
  provider-backed degraded mode, mutating-event idempotency, tenant-data backup semantics,
  delivered semantic completeness, and prod mock prohibition.
- **R35 semantic-closure** — runtime behaviours discovered from events, proof scripts, state
  transitions, routes, and commands must have semantic representation.
- **R36 regeneration-sufficiency** — the semantic artefacts alone must reconstruct the capability
  graph, interaction graph, event graph, environment matrix, and UI semantic model without invention.
- **R37 semantic-entropy** — duplicate concepts, owners, event definitions, readiness definitions,
  state machines, and contradictory definitions are rejected.
- **R40 operational-assurance** — every delivered capability defines deployment, configuration,
  migration, rollback, backup/restore, degraded/recovery mode, operator action, incident class,
  runbook, and safe failure semantics.
- **R41 observability-assurance** — capability-to-route/trace/log/metric/alert coverage is present;
  mutations have audit coverage and events have trace-correlation evidence.
- **R42 security-assurance** — permissions, RBAC/ABAC/PDP policy, audit, secrets, data
  classification, and security risk are governed for every capability.
- **R43 audit-assurance** — every mutation traces to audit event semantics with before/after,
  actor, resource, timestamp, and correlation coverage.
- **R44 event-assurance** — every event has owner, producer, consumer, schema, version,
  idempotency, retry, DLQ, retention, and privacy semantics.
- **R45 environment-assurance** — every capability/environment cell declares provider,
  mock/proof/promotion/rollback/tenant-data/network/secret policy and the expected
  dev/test/staging/prod operating posture.
- **R46 data-assurance** — tenant-data capabilities have owner, classification, retention, backup,
  restore, export, legal hold, DSR, and lineage semantics.
- **R47 dependency-assurance** — capability, provider, and operational dependencies are explicit,
  owned, and risk-described.
- **R48 reliability-assurance** — provider-backed capabilities define timeout/failure handling,
  retry, circuit-breaker/degraded posture, fallback, and recovery.
- **R49 capability-coverage** — each capability is covered across semantics, proofs, events,
  environments, operations, security, audit, observability, and governance.
- **R50 runtime-alignment** — semantic claims must align with proof and runtime evidence: logs,
  metrics, traces, alerts, audit records, and proof execution.

R1–R8 + R10–R50 are the consistency validation (must pass); R9 is the fail-closed cut gate.

Tests: `node --test tools/v2-readiness/tests/*.test.mjs` (also run via the canonical `test:architecture`
gate, ADR-ACT-0292).
