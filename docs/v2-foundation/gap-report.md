# V1→V2 Reconciliation — Gap Report (Pass Three: semantic closure)

**Verdict: GREEN — no remaining V1 completion blockers.**

Pass two reconciled _counts_ (every file/command/test/capability had _a_ disposition) but not
_semantics_: several capabilities that were previously reported as `delivered-and-proven` were
incorrectly masking live blockers; and the deprecated zero-consumer packages were left as
canonical V2 homes while the runbook claimed a clean tree. This pass replaces count-reconciliation
with **honest semantic closure**.

`ZERO UNRESOLVED GAPS` may be claimed when `npm run v2:readiness` is green with zero completion
blockers; current status is zero-gap.

> **Pass Four update — UI semantic closure (V1C-01/02/05/06).** Four UI semantic gaps were closed
> `delivered-and-proven` via the Semantic Reference Harness (`tools/ui-reference-harness`): **Tenant
> groups** (`proof:ui-semantic-groups`), **Sub-organisations** (`proof:ui-semantic-sub-organisations`,
> flat list — no invented hierarchy), and **Claim mapping** (`proof:ui-semantic-claim-mapping`, with
> the external real-IdP proof limitation kept explicit and separate per ADR-ACT-0220). Each was closed
> only on a **passing headless journey**, not a schema entry. **Completion-blocker total: 0**
> (0 capability completions + 0 package removals). V1C-18 is now closed by fresh security proofs;
> V1C-17 is now closed by live runtime proofs (`proof:metrics-prometheus`, `proof:dashboards`) against
> the env-specific Prometheus scrape target.

Audited V1 commit: `918cd148569f6473eeaa58284933abdc0fe5bafe` (the commit the artefacts were built
against). The freeze/cut commit is pinned separately at cut time (`{{PINNED_V1_COMMIT}}`, runbook §1).

## The three classes of remaining work

The closure programme is split into the three honest categories the validator distinguishes.

### A. Semantic gaps remaining

0 capabilities are `requires-v1-completion`. Each capability now has an honest final status in
`v1-capability-closure.json`, and none is hidden inside a delivered count.

| Action | Capability |
| ------ | ---------- |

Plus **8 config-runtime bounded decisions** (`V1C-CONF-01..08`, decomposed from the former single
`V1C-PKG-CONFIG` by the §2 env/config audit — typed loading, schema validation, immutable projections,
secret references, app-specific config, direct-env-access restriction, test overrides, reload/restart).
The `config-runtime` package fate is settled: keep-canonical as `runtime/config`.

### B. Execution-only actions remaining (zero discovery — mechanical)

These carry a resolved disposition; only execution remains (see `v1-completion-programme.md` P1–P3):

| Action class                | Count   | Notes                                                             |
| --------------------------- | ------- | ----------------------------------------------------------------- |
| `delete-after-proof`        | 85      | incl. 10 deprecated zero-consumer packages (see §C) + `.gitkeep`s |
| `git-move`                  | 19      | history-preserving relocations                                    |
| `regenerate`                | 179     | evidence/SBOM/README/inventories — tooling-produced               |
| `archive-evidence`          | 174     | historical records, no active gate                                |
| `refactor-behind-contract`  | 104     | implementation swap behind a frozen interface                     |
| `replace-retain-contract`   | 51      | visual/impl replacement, retained contract                        |
| `split` / `merge`           | 1 / 1   | path-map structural moves                                         |
| command `merge`             | 42      | duplicate-command collapse                                        |
| test `retarget` / `promote` | 61 / 76 | path/selector updates + conformance promotions                    |

### C. Branch-cut blockers (the gate fails closed while any remain)

1. **0 capability completions** (§A).
2. **0 deprecated zero-consumer package removals** — all removals have been reconciled.
3. **0 config-runtime bounded decisions** — `V1C-CONF-01..08` are closed.

**Completion-blocker total: 0** = 0 capability completions + 0 package removals
(live truth: `npm run v2:readiness --json` `.completionBlockerCount`).

## What pass two got wrong (now fixed)

- **Count bucket aliasing**: pass two collapsed `refactor-behind-contract` (104) +
  `replace-retain-contract` (51, was 52) into a fake `reuse 1239` bucket. Buckets now match the
  path-map vocabulary exactly.
- **False `delivered-and-proven`**: the blocker list has been corrected in the checked-in
  reconciliation artefacts; `v2:readiness` now reports remaining completion blockers.
- **Deprecated packages kept as V2 homes**: removed from the target tree, dispositioned
  `delete-after-proof`, scaffold tests retired.
- **Unresolved audited-commit placeholder**: replaced with the concrete audited SHA above; the
  separate freeze/cut commit is parameterised as `{{PINNED_V1_COMMIT}}`.

## Honest closure status

| Class                                      | Count | Blocks cut? |
| ------------------------------------------ | ----- | ----------- |
| delivered-and-proven                       | 70    | no          |
| requires-v1-completion                     | 0     | no          |
| superseded-by-proven-canonical             | 1     | no          |
| not-applicable-final                       | 4     | no          |
| config-runtime decisions (V1C-CONF-01..08) | 8     | no          |
| deprecated package removals                | 0     | no          |

**The project is ready for the mechanical V2 branch cut gate**: `npm run v2:readiness` exits zero when
the checked-in artefacts and live repo stay consistent.
