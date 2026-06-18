# V2 Branch-Cut Runbook

> Governing intent: V1 (repo `maldous/react`, hexagonal enterprise monorepo, audited
> source commit **`918cd148569f6473eeaa58284933abdc0fe5bafe`**) is the **complete reference** for V2. V2
> **reuses / moves / refines / wraps** proven V1 assets; it requires **zero discovery**.
> The final V2 tree is clean — no `legacy/`, `temp/`, `transitional`, `-old`, `-new`,
> `-v2` naming and no deprecated runtime packages. The V1 UI is a **proof harness**: its
> visual layer may be replaced, but its behaviours, commands, queries, validation,
> permissions, error states, a11y, journeys, fixtures and Playwright proofs are the
> **semantic source** for the AI-generated V2 UI.
>
> This runbook is **procedure only**. It does not modify any product/runtime file. It is
> the authoritative ordering for the cut; every step has an explicit gate and an explicit
> rollback. Do not improvise ordering — the sequence below is dependency-ordered so that
> git history is preserved and no step leaves the tree in an unbuildable intermediate
> state that is published as the V2 baseline.

---

## 0. Pre-cut invariants (must all hold before any step in §1)

The cut may not begin until the V2-foundation artefacts in `docs/v2-foundation/` are
**complete and self-consistent**, and the V2-readiness validator
(`tools/v2-readiness/`, specified in `v2-readiness-validator-spec.md`) reports **green**:

- `v1-file-inventory.json` — every tracked V1 file enumerated.
- `v1-to-v2-path-map.json` — every tracked file has a `disposition` from the canonical
  vocabulary (`reuse-unchanged` / `git-move` / `split` / `merge` / `regenerate` /
  `archive-evidence` / `delete-after-proof` / `refactor-behind-contract` /
  `replace-retain-contract`); active dispositions carry a `v2Path`, `delete-after-proof` carries
  `v2Path: null`; **no file unmapped**.
- `v1-command-catalog.json` / `v2-command-map.json` — every Make target and npm script
  has a `disposition` (`carry` / `merge` / `retire`); `merge`/`retire` carry a `retireReason`;
  **none unmapped**.
- `v1-test-proof-inventory.json` / `v2-test-proof-map.json` — every test/proof has a
  `migrationType` (`carry` / `retarget` / `promote-to-conformance` / `retire`); `retire` carries a
  `retirementJustification`.
- `v1-capability-closure.json` — every capability has one honest `status`
  (`delivered-and-proven` / `not-applicable-final` / `rejected-final` /
  `superseded-by-proven-canonical` / `requires-v1-completion`); **`delivered-and-proven` is forbidden**
  when route is missing/partial (without `acceptablePartialRoute`), contract missing, permission "to
  define", readiness deferred, proof not-yet-proven, or the `openAction` says "must close before V2
  cut"; every `requires-v1-completion` has a `completionAction` in `v1-completion-programme.md`.
- `v2-decision-catalog.json` + `v2-decision-lineage.json` — every V2-ADR `Accepted`,
  every V1 ADR/action it descends from resolved (no open/proposed lineage).
- `authentication-authorisation-matrix.json`, `service-and-clickthrough-matrix.json`,
  `environment-and-config-catalog.json`, `data-and-migration-plan.json`,
  `ui-capability-model.json`, `ui-component-contracts.json`, `ui-definition.schema.json`,
  `v1-knowledge-ledger.json`, `v2-directory-contracts.json`, `v2-target-tree.txt`.

**Gate:** `node tools/v2-readiness/src/index.mjs --strict` exits `0`.
**Rollback:** none required — nothing has been mutated. Fix artefacts, re-run.

---

## 1. Final V1 source commit

1. Resolve and **pin** the final V1 source (freeze) commit. The artefacts in
   `docs/v2-foundation/` were built against the **audited** commit
   `918cd148569f6473eeaa58284933abdc0fe5bafe` (concrete, fixed). The **freeze** commit is the
   distinct SHA that HEAD of `main` resolves to at cut time — parameterised here as
   `{{PINNED_V1_COMMIT}}` until pinned. At freeze, replace `{{PINNED_V1_COMMIT}}` with the concrete
   SHA in this runbook and pass it as the validator's `pinnedV1Commit` input (which rejects
   `{{PINNED_V1_COMMIT}}`/`<undefined>` under `--strict`).
2. Confirm working tree clean: `git status --short` is empty.
3. Confirm CI baseline green on that SHA: `make all` (authoritative ladder, Sonar runs
   once) passes on a clean machine / Testbox.

**Gate:** `git rev-parse --verify {{PINNED_V1_COMMIT}}` resolves; `make all` green on it.
**Rollback:** abort the cut; the source commit is unchanged on `main`.

---

## 2. Final evidence-only attestation commit

The last commit on V1 `main` before the cut is an **evidence-only** commit — it changes
nothing executable.

1. Land the completed `docs/v2-foundation/` artefact set and a
   `docs/evidence/v2-foundation/branch-cut-attestation.md` recording: the pinned V1 SHA,
   the green `make all` run, the green validator run, and the artefact checksums.
2. Update `docs/adr/ACTION-REGISTER.md` with the branch-cut action row → `In progress`.
3. Commit using repo provenance: only files under `docs/` change. **No** `apps/`,
   `packages/`, `services/`, `tools/` (runtime), `Makefile`, or `compose.yaml` changes.

**Gate:** diff of this commit touches only `docs/`; `make check` still green.
**Rollback:** `git revert` the attestation commit; artefacts and evidence remain in
history for audit.

---

## 3. Immutable final V1 tag

1. Tag the attestation commit as the immutable V1 frontier:
   `git tag -a v1-final -m "V1 frozen frontier; semantic source for V2 ({{PINNED_V1_COMMIT}})"`.
2. Push the tag: `git push origin v1-final`.
3. Treat `v1-final` as **immutable** — it is never moved, deleted, or re-pointed. All V2
   lineage and rollback references resolve to this tag, not to a moving branch.

**Gate:** `git rev-parse v1-final` resolves on the remote; tag is annotated.
**Rollback:** delete the local/remote tag (`git tag -d`, `git push --delete`) only before
any V2 work depends on it; after that it is frozen.

---

## 4. Branch protection / freeze

1. Enable branch protection on `main` (the V1 line): require PR review, require status
   checks (`make all` gate), forbid force-push, forbid deletion.
2. Announce the **freeze window**: no V1 feature work merges during the cut except the
   urgent-fix carve-out in §13.
3. Lock the freeze in CI: a guard job fails any PR to `main` not labelled `v1-urgent-fix`
   for the duration of the cut.

**Gate:** protection rules active; freeze guard job present and passing.
**Rollback:** lift protection rules; remove the freeze guard. V1 returns to normal flow.

---

## 5. V2 branch creation

1. Create the V2 branch **from the immutable tag**, not from a moving `main`:
   `git switch -c v2-baseline v1-final`.
2. Push it: `git push -u origin v2-baseline`.
3. The branch is **not** set as the repository default/primary yet (see §14). It carries
   the full V1 history so that `git mv` in §6 preserves provenance.

**Gate:** `git merge-base --is-ancestor v1-final v2-baseline` is true; history intact.
**Rollback:** delete `v2-baseline`; re-create from `v1-final`. V1 untouched.

---

## 6. Mechanical restructuring sequence

Performed **only** on `v2-baseline`, strictly in the order the artefacts dictate so the
tree is never left half-moved across a commit boundary. Drive moves by the
`migrationSeq` field in `v1-to-v2-path-map.json` (lower sequence first).

1. **Directories / package shells first** (lowest `migrationSeq`): establish the V2
   target directory shells per `v2-target-tree.txt` and `v2-directory-contracts.json`
   (the two app roots `apps/platform-api` and `apps/web` are both retained as-is — V2 keeps
   the V1 application names; see the app-root invariant in `v2-readiness-validator-spec.md` §4 R15).
2. **Move runtime packages** in dependency order: `packages/domain`, `packages/runtime`,
   `packages/contracts`, `packages/platform`, `packages/adapters`, then `apps/*`, then
   `services/*`.
3. **Retire** `disposition: retire` paths and **merge** duplicate commands per
   `v2-command-map.json` (e.g. `make all-promote` / `make release-confidence` collapse
   into `make all`).
4. One logical group per commit; each commit must leave the tree describable by the
   directory contracts even if not yet buildable (buildability is restored by §8–§9).

**Gate:** after each commit, `tools/v2-readiness` path-lineage rule still green; final
tree matches `v2-target-tree.txt`.
**Rollback:** `git reset --hard` to the prior group commit (V2 branch only); the tag and
V1 are never affected.

---

## 7. `git mv` strategy to preserve history

1. Use `git mv <old> <new>` for **every** relocation — never delete-and-recreate, which
   severs `--follow` history.
2. Move whole directories with `git mv` of the directory; rename files inside afterward.
3. Keep each move **content-identical** in the move commit. Any content edit
   (refine/wrap) happens in a **separate follow-up commit** so `git log --follow` and
   blame remain clean across the rename.
4. Verify provenance: `git log --follow --oneline <newPath>` reaches back through
   `v1-final` for every moved file.

**Gate:** spot-check `--follow` reaches the V1 history for moved files; no file shows as
a fresh add in the move commit.
**Rollback:** `git reset --hard` the move commit; re-issue `git mv` with corrected paths.

---

## 8. Test retargeting sequence

Driven by `v2-test-proof-map.json`, **after** the files they protect have moved (§6/§7),
so tests are never orphaned:

1. `carry` tests: moved by `git mv` alongside their subject; assert no behavioural change.
2. `retarget` tests: update describe-paths / fixture roots only (`selectorsOrImportsChange`
   flag indicates which need selector/import edits).
3. `becomes-contract` tests: promote to reusable contract tests where the artefact marks
   `becomesReusableContract: true`.
4. `retire` tests: remove only with a recorded `retirementJustification`.
5. Re-point test runners and explicit test lists (`test:platform-api` enumerated list,
   Playwright config projects) at the new paths.

**Gate:** `npm run test:platform-api`, `npm run test:frontend:run`,
`npm run test:architecture` green on `v2-baseline`.
**Rollback:** revert the retarget commit; the carried tests still execute against moved
subjects from §6.

---

## 9. Import / path update sequence

1. Update internal import specifiers and package names to the V2 paths (e.g.
   `@platform/...` package renames). The app roots `apps/platform-api` and `apps/web` are NOT
   renamed in V2 (move-as-is); only deprecated-package removals and `packages/*` regrouping apply.
2. Update `tsconfig.base.json` path aliases, workspace globs in root `package.json`,
   `knip.json`, ESLint/import-boundary config, and `docs/architecture/import-boundary-rules.json`.
3. Run the architecture orchestrator to enforce hexagonal boundaries hold post-rename:
   `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict`.

**Gate:** typecheck + orchestrator green; no import-boundary violation; OpenAPI drift
gate green (`validate-openapi-drift --strict`).
**Rollback:** revert the import-update commit; restore prior alias config.

---

## 10. Schema migration sequence

Per `data-and-migration-plan.json`. Committed V1 migrations are **checksum-immutable** —
they are carried unchanged; V2 changes are **forward-only**.

1. **Carry** all existing committed migrations verbatim (never edit a landed migration —
   checksum immutability).
2. Append any V2-structural migrations as **new, forward-only** files at the next
   sequence number, with re-`GRANT USAGE ... TO PUBLIC` where a schema reset is involved
   (rls_bypass visibility gotcha).
3. Run `make db-migrate` against a fresh DB and against a seeded DB; both must succeed.

**Gate:** `make db-migrate` clean on fresh + seeded; migration checksum gate green.
**Rollback:** drop the appended forward migration file (it is new and unreferenced);
carried migrations are untouched.

---

## 11. Env / Compose transition

Per `environment-and-config-catalog.json` and `service-and-clickthrough-matrix.json`.

1. The `.env/` tree is **generated** from manifests (ADR-0072) — regenerate, never
   hand-edit; secrets stay in their `.env.*` files and Terraform sources them via
   `TF_VAR_*` (never hardcoded `.tfvars`).
2. Rename Compose services/profiles only where the command/service map requires it; keep
   default profile set (`postgres redis clickhouse minio mailpit otel-collector`).
3. Update every composed service with a GUI to carry its clickthrough policy row +
   `platform.clickthrough.<svc>` permission (no orphan services).
4. Validate: `npm run compose:config` and `npm run compose:config:all`.

**Gate:** both compose-config validators green; `make compose-up-default` +
`make compose-ps` healthy; health/readyz endpoints answer.
**Rollback:** regenerate `.env/` from the prior manifest revision; revert compose rename
commit.

---

## 12. Rollback strategy (whole-cut)

- The cut is **atomic at the branch level**: V1 `main` and `v1-final` are never mutated by
  any step §5–§11. The entire V2 effort can be abandoned by deleting `v2-baseline`.
- Per-step rollback is the `git reset --hard <prior-group-commit>` on `v2-baseline` noted
  in each section; because every step is one logical commit, rollback granularity equals
  the section granularity.
- No published rollback is needed because `v2-baseline` is **not** primary until §14; any
  consumer still builds against `v1-final`.
- If the cut is abandoned, lift the §4 freeze and V1 resumes with zero residue.

---

## 13. Rules for urgent V1 fixes after the cut

1. Urgent production fixes land on a hotfix branch cut from `main` (the V1 line), labelled
   `v1-urgent-fix`, passing the §4 freeze guard.
2. Each such fix is **dual-tracked**: after merge to `main`, it is **forward-ported** to
   `v2-baseline` via `git cherry-pick -x` (records origin) and reconciled against the
   renamed paths.
3. Record the forward-port in the branch-cut attestation evidence; the validator's
   "planning artefacts drift" rule fails if a `v1-urgent-fix` commit on `main` after
   `v1-final` has no recorded V2 disposition.
4. No urgent fix re-points `v1-final`; the tag stays immutable.

---

## 14. When compatibility shims are removed

1. Compatibility shims (re-export stubs at old import paths, alias Make targets kept for
   muscle memory, transitional config) are permitted **only transiently** on
   `v2-baseline` to keep retargeting incremental.
2. Each shim is tracked with a `deletionCondition` mirrored from `v1-to-v2-path-map.json`
   / `v2-command-map.json`; a shim is removed **the moment its condition holds** (all
   consumers retargeted; merged command's callers updated).
3. The clean-baseline gate in §15 **fails** if any shim survives — the final tree carries
   no transitional naming or deprecated runtime package.

---

## 15. When the branch becomes the clean V2 baseline

`v2-baseline` is promoted to the published primary line **only** when all of the
following operate cleanly — not before:

- **Clean structure:** tree equals `v2-target-tree.txt`; every directory satisfies
  `v2-directory-contracts.json`; zero `legacy/temp/transitional/-old/-new/-v2` naming;
  zero deprecated runtime packages; zero surviving shims (§14).
- **Clean commands:** `make help` lists only the carried/renamed canonical commands;
  merged/retired commands gone; `make all` (single Sonar run) green; `make check` fast.
- **Clean docs:** READMEs regenerated (`make readmes`); ADR/action register reflects V2
  decisions; `docs/v2-foundation/` retained as historical lineage.
- **Baseline tests:** `npm run test:platform-api`, `test:frontend:run`,
  `test:architecture`, `test:compose`, `test:e2e` green on the new paths; Playwright
  semantic proofs carried/retargeted pass.
- **Validator green:** `tools/v2-readiness --strict` exits `0` with the post-cut inputs.

Only then: set `v2-baseline` as the default branch, retarget protection rules to it,
and archive (do not delete) the V1 `main` line behind `v1-final`.

**Gate:** all bullets above satisfied; one final `make all` green on `v2-baseline`.
**Rollback:** if promotion reveals a gap, default branch reverts to V1 `main`;
`v2-baseline` stays as a branch until the gap closes. `v1-final` is never touched.
