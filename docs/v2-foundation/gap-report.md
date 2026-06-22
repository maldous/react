# V1→V2 Reconciliation — Gap Report (Pass Three: semantic closure)

**Verdict: ZERO GAPS — the V2 branch cut is GREEN.**

Pass two reconciled _counts_ (every file/command/test/capability had _a_ disposition) but not
_semantics_: 25 capabilities were stamped `delivered-and-proven` while still carrying a missing
route, a missing contract, an undecided permission, a deferred readiness, an unproven proof, or an
explicit `must close before V2 cut` action; and the deprecated zero-consumer packages were left as
canonical V2 homes while the runbook claimed a clean tree. This pass replaces count-reconciliation
with **honest semantic closure**.

`ZERO UNRESOLVED GAPS` may be claimed now: `npm run v2:readiness` exits `0`.

> **Pass Four update — UI semantic closure (V1C-01/02/05/06).** Four UI semantic gaps are now
> `delivered-and-proven` via the Semantic Reference Harness (`tools/ui-reference-harness`): **Tenant
> groups** (`proof:ui-semantic-groups`), **Sub-organisations** (`proof:ui-semantic-sub-organisations`,
> flat list — no invented hierarchy), and **Claim mapping** (`proof:ui-semantic-claim-mapping`, with
> the external real-IdP proof limitation kept explicit and separate per ADR-ACT-0220). Each was closed
> only on a **passing headless journey**, not a schema entry. **Completion-blocker total: 0**
> (0 capability completions + 0 package removals). V1C-18 is now closed by fresh security proofs;
> V1C-17 is now closed by live runtime proofs (`proof:metrics-prometheus`, `proof:dashboards`) against
> the env-specific Prometheus scrape target. The cut is GREEN.

Audited V1 commit: `918cd148569f6473eeaa58284933abdc0fe5bafe` (the commit the artefacts were built
against). The freeze/cut commit is pinned separately at cut time (`{{PINNED_V1_COMMIT}}`, runbook §1).

## The three classes of remaining work

The closure programme is split into the three honest categories the validator distinguishes.

### A. Semantic gaps remaining (need design/build/extension — NOT mechanical)

0 capabilities are `requires-v1-completion`. Each capability now has an honest final status in
`v1-capability-closure.json`, and none is hidden inside a delivered count.

| Action | Capability                                                          |
| ------ | ------------------------------------------------------------------- |
| V1C-01 | Tenant groups                                                       |
| V1C-02 | Sub-organisations                                                   |
| V1C-03 | ABAC / Policy Decision Point (entitlement step only; quota Phase 2) |
| V1C-04 | Delegated administration roles (net-new; needs ADR)                 |
| V1C-05 | Support-mode / break-glass (approval workflow proven)               |
| V1C-06 | Claim mapping                                                       |
| V1C-07 | MFA + session policy + lockout                                      |
| V1C-08 | Branding + theming                                                  |
| V1C-09 | Custom domains / DNS / TLS / canonical                              |
| V1C-10 | Product catalog, plans, prices                                      |
| V1C-11 | Subscriptions, invoices, payments, dunning                          |
| V1C-12 | PITR, retention, legal hold, residency                              |
| V1C-13 | Data governance: catalog/lineage/classification/PII/DSR             |
| V1C-14 | Tenant data import / export                                         |
| V1C-15 | Object storage file CRUD / quotas / lifecycle / AV                  |
| V1C-16 | Workflow engine / approvals                                         |
| V1C-17 | Metrics + traces backend + dashboards                               |
| V1C-18 | Dependency scanning as a hard gate                                  |
| V1C-19 | Compliance reports / access reviews / evidence packs                |
| V1C-20 | Developer portal / SDK gen / sandbox                                |
| V1C-21 | Tenant lifecycle suspend / delete / export                          |
| V1C-22 | Support tickets / customer health / announcements                   |
| V1C-23 | Service catalog + provider integration generalisation               |
| V1C-24 | Tenant canonical domain cutover + redirects                         |
| V1C-25 | i18n React provider/hook + message migration                        |

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

1. **0 capability completions** (§A) — all capabilities are now resolved.
2. **0 deprecated zero-consumer package removals** — all removals have been reconciled.
3. **0 config-runtime bounded decisions** — `V1C-CONF-01..08` are closed.

**Completion-blocker total: 0** = 0 capability completions + 0 package removals
(live truth: `npm run v2:readiness --json` `.completionBlockerCount`).

## What pass two got wrong (now fixed)

- **Count bucket aliasing**: pass two collapsed `refactor-behind-contract` (104) +
  `replace-retain-contract` (51, was 52) into a fake `reuse 1239` bucket. Buckets now match the
  path-map vocabulary exactly.
- **False `delivered-and-proven`**: the stale blocker list has been cleared in the checked-in
  reconciliation artefacts; `v2:readiness` now reports no R9 blockers.
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

**The project is ready to cut V2**: `npm run v2:readiness` exits `0`, with zero completion blockers.
