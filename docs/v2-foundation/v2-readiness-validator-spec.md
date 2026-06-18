# V2-Readiness Validator — Specification

> Governing intent: V1 (`maldous/react`, audited commit
> `918cd148569f6473eeaa58284933abdc0fe5bafe`) is the complete reference for V2; V2
> reuses/moves/refines/wraps proven V1 assets with **zero discovery** and a **clean final tree**.
> This spec describes `tools/v2-readiness/`, which **is implemented** (`src/index.mjs`) and wired as
> the npm scripts `v2:readiness` / `v2:readiness:json`. It is **not** wired into `make all`; it runs
> on demand as the §0 / §15 gate of the branch-cut runbook. The validator writes no runtime file.

## 1. Purpose

A deterministic, read-only checker that proves `docs/v2-foundation/` planning closure is **total and
semantically self-consistent** — not merely count-reconciled. It fails closed: any contradiction is an
error and exit `1`.

## 2. Placement & invocation

- Location: `tools/v2-readiness/` (sibling of `tools/architecture/`).
  - `src/index.mjs` — CLI entrypoint (`node src/index.mjs [--strict] [--json] [--repo <root>] [--pinned <sha>]`).
  - `src/load.mjs` — artefact + repo loaders.
  - `src/rules/*.mjs` — one module per rule (§4).
  - `tests/*.test.mjs` — node:test suite (§5).
- Exit codes: `0` = all rules pass; `1` = one or more findings; `2` = bad input / missing artefact.
  `--strict` makes warnings fatal and rejects an unresolved `pinnedV1Commit`.
- **Not** referenced by any Makefile target. Wired only as root npm scripts `v2:readiness` /
  `v2:readiness:json`.

## 3. Canonical vocabularies (must match the artefacts exactly)

These are the ONLY allowed values; the validator normalises no aliases.

| Domain                | Canonical values                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| file `disposition`    | `reuse-unchanged`, `git-move`, `split`, `merge`, `regenerate`, `archive-evidence`, `delete-after-proof`, `refactor-behind-contract`, `replace-retain-contract` |
| command `disposition` | `carry`, `merge`, `retire`                                                                                                                                     |
| test `migrationType`  | `carry`, `retarget`, `promote-to-conformance`, `retire`                                                                                                        |
| capability `status`   | `delivered-and-proven`, `not-applicable-final`, `rejected-final`, `superseded-by-proven-canonical`, `requires-v1-completion`                                   |

`pinnedV1Commit` input: the audited SHA `918cd148569f6473eeaa58284933abdc0fe5bafe` by default; the
freeze commit is supplied via `--pinned`. Under `--strict` the values `<undefined>`,
`{{PINNED_V1_COMMIT}}`, `TBD`, `TODO`, and empty are rejected. `{{PINNED_V1_COMMIT}}` is the sanctioned
_named_ parameter everywhere else (not a forbidden placeholder).

## 4. Rules (each yields findings; any finding fails the gate)

Each rule emits `{ruleId, severity, subject, message}`.

| ID                        | Fails when                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R1-placeholder`          | a closure-claim artefact (`gap-report.md`, `v1-completion-programme.md`, `v1-capability-closure.json`, `zero-gap-reconciliation.json`) contains a hard placeholder token (`<undefined>`, `TBD`, `TODO`, `must decide`, `candidate`, `not integrated`); or `pinnedV1Commit` is unresolved under `--strict`. `{{PINNED_V1_COMMIT}}` is allowed.                                                                      |
| `R2-capability-integrity` | a `delivered-and-proven` capability has route missing or `partial` (without `acceptablePartialRoute: true`), contract `missing`, permission `to define`, readiness `deferred`/`to define`, proof `not-yet-proven`/`blocked`, or an `openAction` containing `must close`/`blocker`/`before V2 cut`; or a `requires-v1-completion` capability has no `completionAction`.                                             |
| `R3-zero-gap-honesty`     | any artefact text asserts `ZERO UNRESOLVED GAPS` / `gap-free` / `zero gaps` while ≥1 capability is `requires-v1-completion` or an open package decision exists.                                                                                                                                                                                                                                                    |
| `R4-vocabulary`           | any `disposition` / `migrationType` / capability `status` is outside the canonical vocabulary (§3).                                                                                                                                                                                                                                                                                                                |
| `R5-count-buckets`        | `zero-gap-reconciliation.json` file/command/test/capability buckets do not equal the counts recomputed from the source artefacts, OR use bucket names that differ from the path-map vocabulary (the pass-two `reuse 1239` alias is the canonical failure).                                                                                                                                                         |
| `R6-package-removal`      | a `delete-after-proof` path has a non-null `v2Path`; a `delete-after-proof` package's V2 home still appears in `v2-target-tree.txt`; or a known-deprecated package (ADR-ACT-0289 set) has a non-`delete-after-proof` disposition without a recorded final keep decision.                                                                                                                                           |
| `R7-soft-mapping`         | a `delete-after-proof` entry has an empty/`n/a` `deletionCondition`; or a `delete-after-proof` **package** file (non-`.gitkeep`) has empty `decisionRefs` (metadata/README/package files may not be cleared as "no runtime behaviour" without an explicit final decision reference).                                                                                                                               |
| `R8-runbook-tooling`      | the branch-cut runbook depends on `tools/v2-readiness` but `src/index.mjs` is absent or the `v2:readiness` npm script is missing; or the runbook does not record the resolved audited commit.                                                                                                                                                                                                                      |
| `R9-branch-cut-blocker`   | a fail-closed cut gate: any `requires-v1-completion` capability, any deprecated zero-consumer package still present (pending `delete-after-proof` execution), or any open package decision is reported as a blocker. These are NOT honesty violations — the artefacts record them correctly — but they keep the gate RED so that `v2:readiness` exiting `0` truly means "ready to cut / ready to claim zero gaps". |

Scoping note: R1/R3 deliberately scan only the **closure-claim** artefacts, not this spec or the
runbook (which legitimately name the tokens they forbid). R2's field checks apply only to
`delivered-and-proven` records — a `requires-v1-completion` record is _expected_ to carry `missing` /
`not-yet-proven` honestly and must not be flagged.

## 5. Tests (`tools/v2-readiness/tests/`)

node:test, fixture-driven, no network/DB (`fixtures.mjs` provides a `cleanCtx()` factory that passes
every rule; each test clones + mutates it to fire exactly one rule).

- `rules.test.mjs` — pass + fail per rule R1–R9: hard placeholder fires / `{{PINNED_V1_COMMIT}}`
  clean; `delivered-and-proven` + `route:"missing"`/`must close` fires and `acceptablePartialRoute`
  clears a partial route; affirmative zero-gap claim fires but an honest negation does not;
  off-vocabulary value fires; collapsed `reuse:1239` bucket + count mismatch fire;
  `delete-after-proof` with a `v2Path`/surviving tree home/non-`delete-after-proof` deprecated package
  fire; package `delete-after-proof` without `decisionRefs` fires; missing `v2:readiness` script
  fires; R9 reports completions + deprecated packages as blockers. (20 assertions.)
- `cli.test.mjs` — exit codes `0` (materialised clean temp repo) / `1` (live repo, RED) / `2`
  (missing repo); `--json` report shape (`ok`, `findings`, `pinnedV1Commit`, `totalRules`).
- `golden.test.mjs` — runs against the real `docs/v2-foundation/` set; asserts zero consistency
  violations (R1–R8) and that the only RED is the honest outstanding work (R9). The live tree is
  **not** green today — 25 `requires-v1-completion` + 10 package removals + 1 open decision.

## 6. Output

`{ pinnedV1Commit, ranAt, totalRules, findings:[{ruleId,severity,subject,message}], ok:boolean }`.
Human mode prints grouped findings + a one-line verdict; `--json` prints the object. Exit `0` only when
`findings` is empty (or only warnings without `--strict`).
