# V2-Readiness Validator — Specification

> Governing intent: V1 (`maldous/react`, audited commit `<undefined>`) is the complete
> reference for V2; V2 reuses/moves/refines/wraps proven V1 assets with **zero discovery**
> and a **clean final tree**. This spec **designs** `tools/v2-readiness/` — it is **not**
> wired into the `make all` confidence ladder. It is run **on demand** as the §0 / §15 gate
> of the branch-cut runbook (`node tools/v2-readiness/src/index.mjs --strict`). This
> document writes no runtime file and only describes the tool.

## 1. Purpose

A deterministic, read-only checker that proves the `docs/v2-foundation/` planning closure
is **total and self-consistent** against the live V1 repository: every tracked V1 asset,
command, test, decision, capability and provider has an explicit, resolved V2 disposition,
and every V2 target path traces back to V1 lineage. It fails closed: any gap is an error.

## 2. Placement & invocation

- Location: `tools/v2-readiness/` (sibling of `tools/architecture/`).
  - `src/index.mjs` — CLI entrypoint (`node src/index.mjs [--strict] [--json] [--repo <root>]`).
  - `src/rules/*.mjs` — one module per rule (§4).
  - `src/load.mjs` — artefact + repo loaders (§3).
  - `tests/*.test.ts` — node:test suite (§5).
- Exit codes: `0` = all rules pass; `1` = one or more findings; `2` = bad input / missing
  artefact. `--strict` makes warnings fatal. `--json` emits a machine report.
- **Not** referenced by any Makefile target or npm script (explicit non-wiring).

## 3. Input schema

The validator loads two input sets and never writes anything.

### 3.1 Repository inputs (observed, read-only)

- `gitTrackedFiles`: output of `git ls-files` at the pinned `pinnedV1Commit`.
- `makeTargets`: parsed from `Makefile` + `make/*.mk` (`^[a-zA-Z0-9_-]+:` rule heads).
- `npmScripts`: keys of `scripts` in root `package.json`.
- `adrFiles`: `docs/adr/*.md`; `actionRegister`: parsed rows of
  `docs/adr/ACTION-REGISTER.md` (id, status).
- `composeServices`: services/profiles in `compose.yaml`.

### 3.2 Planning artefacts (`docs/v2-foundation/`)

Each loaded and shape-checked. `pinnedV1Commit` is a required CLI/env input (the runbook
§1 SHA; rejects the literal `<undefined>` under `--strict`).

| Artefact                                                                                          | Required fields (per record)                                                                      |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `v1-file-inventory.json`                                                                          | `path`                                                                                            |
| `v1-to-v2-path-map.json`                                                                          | `v1Path`, `v2Path`, `disposition`, `migrationSeq`, `deletionCondition`                            |
| `v1-command-catalog.json` / `v2-command-map.json`                                                 | `v1Name`, `v2Name`, `disposition`, `retireReason`                                                 |
| `v1-test-proof-inventory.json`                                                                    | `path`, `behaviourProtected`                                                                      |
| `v2-test-proof-map.json`                                                                          | `v1Path`, `v2Path`, `migrationType`, `retirementJustification`                                    |
| `v1-capability-closure.json`                                                                      | `capability`, `status`, `route`, `permission`, `contract`, `port`, `adapter`, `evidence`, `proof` |
| `v2-decision-catalog.json`                                                                        | `v2AdrId`, `status`                                                                               |
| `v2-decision-lineage.json`                                                                        | `v2AdrId`, `v1Adrs`, `v1Actions`                                                                  |
| `authentication-authorisation-matrix.json`                                                        | provider rows with `selected`, `adapter`, `proof`                                                 |
| `service-and-clickthrough-matrix.json`                                                            | `service`, `clickthroughPolicy`, `permission`                                                     |
| `v2-directory-contracts.json`                                                                     | `path`, `allowedContents`, `forbiddenContents`, `dependencyDirection`                             |
| `v2-target-tree.txt`                                                                              | newline-delimited target paths                                                                    |
| `data-and-migration-plan.json`, `environment-and-config-catalog.json`, `v1-knowledge-ledger.json` | presence + non-empty                                                                              |

Disposition enums: files `{reuse-unchanged, move, refine, wrap, retire}`; commands
`{carry, merge, rename, retire}`; tests `{carry, retarget, becomes-contract, retire}`.

## 4. Rules (each yields findings; any finding fails the gate)

Each rule emits `{ruleId, severity, subject, message}`.

| ID                             | Rule — **fails when**                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R1-file-unmapped`             | a `gitTrackedFiles` path has **no** entry in `v1-to-v2-path-map.json` (V1 file unmapped), or a mapped `v1Path` no longer exists in the repo.                                                                                                                                                                      |
| `R2-command-unmapped`          | a `makeTargets` entry or `npmScripts` key has no entry in `v2-command-map.json` / `v1-command-catalog.json` (Make target / npm script unmapped). `merge`/`retire` must carry a `retireReason`.                                                                                                                    |
| `R3-test-no-disposition`       | a `v1-test-proof-inventory.json` test/proof has no record in `v2-test-proof-map.json`; or `migrationType:"retire"` lacks `retirementJustification`; or a `becomes-contract` lacks a V2 contract path.                                                                                                             |
| `R4-adr-unresolved`            | a `v2-decision-catalog.json` ADR is not `Accepted`; or a `v2-decision-lineage` V1 ADR/action it descends from is still open/proposed/in-progress in `actionRegister`; or an `actionRegister` row lacks a V2 disposition.                                                                                          |
| `R5-capability-not-closed`     | a `v1-capability-closure.json` capability `status` is `partial`/`deferred`/`candidate`/`missing`/`blocked` (or any value other than a resolved `delivered-*`/explicitly-retired) without a recorded `resolution`.                                                                                                 |
| `R6-provider-no-adapter-proof` | a row in `authentication-authorisation-matrix.json` (or any provider matrix) has `selected:true` but a missing/empty `adapter` **or** missing/empty `proof` (selected provider lacks adapter/proof).                                                                                                              |
| `R7-target-no-lineage`         | a `v2-target-tree.txt` path (or a `v2Path` in any map) has **no** V1 `v1Path` lineage in `v1-to-v2-path-map.json` and is not justified as a net-new-required path (V2 target without V1 lineage).                                                                                                                 |
| `R8-directory-contract`        | a mapped `v2Path` lands outside its `v2-directory-contracts.json` `allowedContents`, hits `forbiddenContents`, or violates `dependencyDirection` (directory contract violated).                                                                                                                                   |
| `R9-planning-drift`            | the artefact set is internally inconsistent — e.g. a `v2-command-map` `v2Name` not in `v2-target-tree` location set; counts disagree across artefacts; `pinnedV1Commit` is `<undefined>` under `--strict`; or a post-`v1-final` `v1-urgent-fix` commit has no recorded V2 disposition (planning artefacts drift). |

Cross-cutting: a clean-baseline mode (`--baseline`) additionally fails on any path
containing `legacy`/`temp`/`transitional`/`-old`/`-new`/`-v2` and on any surviving shim
whose `deletionCondition` is satisfied (runbook §14/§15).

## 5. Tests (`tools/v2-readiness/tests/`)

node:test, fixture-driven, no network/DB. Each rule gets a **pass** fixture and a
**fail** fixture proving the message fires.

- `r1-file-unmapped.test.ts` — fixture repo with one extra tracked file → R1 fires;
  fully-mapped fixture → clean.
- `r2-command-unmapped.test.ts` — Makefile with an unmapped target → fires; `merge`
  without `retireReason` → fires.
- `r3-test-disposition.test.ts` — inventory test absent from map → fires; `retire`
  without justification → fires.
- `r4-adr-unresolved.test.ts` — `Proposed` V2-ADR → fires; open V1 lineage action → fires.
- `r5-capability.test.ts` — each of `partial/deferred/candidate/missing/blocked` without
  resolution → fires (table-driven).
- `r6-provider.test.ts` — `selected` provider with empty `adapter`/`proof` → fires.
- `r7-lineage.test.ts` — target path with no `v1Path` lineage → fires.
- `r8-directory.test.ts` — `v2Path` in `forbiddenContents` / wrong dependency direction → fires.
- `r9-drift.test.ts` — `pinnedV1Commit:"<undefined>"` under `--strict` → fires; count
  mismatch across artefacts → fires.
- `cli.test.ts` — exit codes `0/1/2`; `--json` shape; `--baseline` naming/shim checks.
- `golden.test.ts` — run against the real `docs/v2-foundation/` set; asserts the report
  shape is valid (informational, not a hard pass, since live closure may still be in flight).

## 6. Output

`{ pinnedV1Commit, ranAt, totalRules, findings:[{ruleId,severity,subject,message}],
ok:boolean }`. Human mode prints grouped findings + a one-line verdict; `--json` prints
the object. Exit `0` only when `findings` is empty (or only warnings without `--strict`).
