# V1 Completion Programme (standalone)

Reconciliation is gap-free (see `zero-gap-reconciliation.json`, `gap-report.md`). No discovery or
design remains. The programme below is **execution-only**: it carries out the dispositions that have
a proof/stop condition. Each action lists exact decision, source ADR, action id, dependencies, source
paths, ports/adapters, contracts/routes/events, migrations, tests, proofs, env/ops, UI semantic
model, acceptance criteria, stop condition, non-goals, and V2 assets produced.

---

## P0 — Blocks the V2 branch cut

**P0-1. Prove zero consumers of deprecated `@platform/domain-core`, then delete.**

- Decision: V2 drops domain-core; helpers superseded by typed platform packages.
- Source ADR / action: ADR-0006, ADR-ACT-0288.
- Dependencies: none (leaf package).
- Source paths: `packages/domain-core/{package.json,README.md,src/index.ts}`.
- Ports/adapters: none (pure helpers: id/timestamp/event).
- Contracts/routes/events: none.
- Migrations: none.
- Tests: run `npm run test:architecture` import-boundary scan to assert no `@platform/domain-core` import in any V2 path.
- Proofs: `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict` showing zero consumers.
- Env/ops: none.
- UI semantic model: n/a.
- Acceptance: orchestrator import graph has zero edges into domain-core; `make check` green.
- Stop condition: package removed from workspace, lockfile regenerated, gate green.
- Non-goals: re-implementing the helpers (already superseded).
- V2 assets produced: clean workspace minus domain-core; updated path-map deletion proof.

**P0-2. Prove `WorkerPort` superseded by USF event-bus/workers, then delete `@platform/worker-runtime`.**

- Decision: worker-runtime replaced by USF event bus + workers (Phase 5).
- Source ADR / action: ADR-0068, ADR-0006, ADR-ACT-0288.
- Dependencies: USF event-bus/workers slice present in V2 (already delivered-and-proven).
- Source paths: `packages/worker-runtime/{package.json,README.md,src/index.ts,tsconfig.json}`.
- Ports/adapters: `WorkerPort` → replaced by USF worker dispatch.
- Contracts/routes/events: worker events now flow through USF event bus.
- Tests: architecture import scan; USF events/workers test suite (carry/promote per v2-test-proof-map).
- Proofs: orchestrator strict run with zero `@platform/worker-runtime` consumers.
- Acceptance: no imports; USF worker tests green.
- Stop condition: package removed, gate green.
- Non-goals: behavioural change to USF workers.
- V2 assets produced: consolidated worker capability under USF.

---

## P1 — Universal / operational

**P1-1. Regenerate the 186 `regenerate` artefacts in V2 context** (evidence JSON/MD, SBOM, SVG
diagrams, README sections, inventories).

- Decision: regenerate deterministically from tooling, never hand-edit.
- Source ADR / action: ADR-0007 (evidence dirs), generator specs under `docs/specs/`.
- Dependencies: V2 tree materialised; `make readmes`, architecture orchestrator, SBOM tooling.
- Tests/proofs: `make readmes`, `node tools/architecture/orchestrator/src/index.mjs all --strict`,
  SBOM build; outputs match committed regenerated files.
- Acceptance: regenerated artefacts reproducible and gate-clean.
- Stop condition: all 186 produced by tooling under V2 paths.
- Non-goals: manual edits to generated sections.
- V2 assets produced: 186 regenerated artefacts at v2Path.

**P1-2. Git-move the 19 `git-move` files** preserving history (no content change).

- Source: path-map entries with `disposition=git-move` and `migrationSeq`.
- Proof: `git log --follow` on each target shows preserved history.
- Acceptance: 19 files at v2Path; history intact; gate green.
- Stop condition: moves committed in migrationSeq order.

---

## P2 — Functional foundation

**P2-1. Apply the 104 `refactor-behind-contract` + 52 `replace-retain-contract` migrations.**

- Decision: keep retained interfaces stable; swap implementation/visual layer behind them.
- Source: path-map `retainedInterfaces`, v2-decision-catalog, ui-component-contracts.
- Dependencies: P0/P1 complete.
- Contracts: retainedInterfaces per entry are the freeze line; UI semantic model from
  `ui-capability-model.json` (behaviours/commands/queries/validation/permissions/error-states/
  a11y/journeys) is the source for AI-generated V2 UI.
- Tests/proofs: protectingTests carried/retargeted/promoted-to-conformance (76) per v2-test-proof-map;
  Playwright journeys re-run.
- Acceptance: retained interfaces unchanged; conformance + journey proofs green.
- Stop condition: all 156 entries land with green protecting tests.
- Non-goals: changing any retained interface or documented behaviour.
- V2 assets produced: refactored implementations + AI-generated UI behind frozen contracts.

**P2-2. Execute split (1) and merge (1+42 command merges).**

- Source: path-map split/merge entries; v2-command-map merge=42.
- Proof: merged commands resolve to single v2Name; split target both reachable; tests green.
- Acceptance/stop: bijective command surface confirmed; `make check` green.

---

## P3 — Optional / selection-close

**P3-1. Archive the 179 `archive-evidence` records** into the V2 historical area.

- Decision: preserve as historical-only; not active gates.
- Source ADR: ADR-0007.
- Proof: files present at archive v2Path; ACTION-REGISTER references intact.
- Acceptance/stop: 179 archived; no active gate depends on them.
- Non-goals: regenerating archived snapshots.

**P3-2. Confirm the 4 `not-applicable-final` capabilities stay out of V2** with recorded
justification (already evidenced); no build work.

- Stop condition: capability registry shows 71 delivered + 4 N/A, none reopened.

---

### Global stop condition for declaring V1 complete

All P0–P3 actions executed; `make all` (authoritative ladder incl. Sonar absolute-zero gate) green;
orchestrator strict pass; zero `delete-after-proof` items remaining undeleted; reconciliation re-run
still reports 0 unresolved gaps.
