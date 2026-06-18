# tools/v2-readiness

Read-only validator that proves the `docs/v2-foundation/` planning closure is **semantically
self-consistent** (not merely count-reconciled) and reports the outstanding branch-cut blockers. It
writes nothing. Spec: `docs/v2-foundation/v2-readiness-validator-spec.md`.

```bash
npm run v2:readiness        # human report, exit 1 while blockers remain
npm run v2:readiness:json   # machine report
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
- **R14 foundation** — the nine foundation artefacts present/shaped; governed contract roots present
  in the tree.
- **R15 app-path** — tree/maps/contracts/runbook agree on the app roots (`apps/platform-api` +
  `apps/web`); `apps/api` appears nowhere.

R1–R8 + R10–R15 are the consistency validation (must pass); R9 is the fail-closed cut gate.

Tests: `node --test tools/v2-readiness/tests/*.test.mjs` (also run via the canonical `test:architecture`
gate, ADR-ACT-0292).
