# V1→V2 Reconciliation — Gap Report (Pass Three: semantic closure)

**Verdict: NOT ZERO GAPS — the V2 branch cut is BLOCKED.**

Pass two reconciled _counts_ (every file/command/test/capability had _a_ disposition) but not
_semantics_: 25 capabilities were stamped `delivered-and-proven` while still carrying a missing
route, a missing contract, an undecided permission, a deferred readiness, an unproven proof, or an
explicit `must close before V2 cut` action; and the deprecated zero-consumer packages were left as
canonical V2 homes while the runbook claimed a clean tree. This pass replaces count-reconciliation
with **honest semantic closure**.

`ZERO UNRESOLVED GAPS` may only be claimed when `npm run v2:readiness` exits `0`. It does not today.

> **Pass Four update — UI semantic closure (V1C-01/02/05/06).** Four UI semantic gaps are now
> `delivered-and-proven` via the Semantic Reference Harness (`tools/ui-reference-harness`): **Tenant
> groups** (`proof:ui-semantic-groups`), **Sub-organisations** (`proof:ui-semantic-sub-organisations`,
> flat list — no invented hierarchy), and **Claim mapping** (`proof:ui-semantic-claim-mapping`, with
> the external real-IdP proof limitation kept explicit and separate per ADR-ACT-0220). Each was closed
> only on a **passing headless journey**, not a schema entry. **Completion-blocker total: 31**
> (21 capability completions + 10 package removals). V1C-18 remains reopened pending fresh proof;
> V1C-17 is now closed by live runtime proofs (`proof:metrics-prometheus`, `proof:dashboards`) against
> the env-specific Prometheus scrape target. The cut remains BLOCKED.

Audited V1 commit: `918cd148569f6473eeaa58284933abdc0fe5bafe` (the commit the artefacts were built
against). The freeze/cut commit is pinned separately at cut time (`{{PINNED_V1_COMMIT}}`, runbook §1).

## The three classes of remaining work

The closure programme is split into the three honest categories the validator distinguishes.

### A. Semantic gaps remaining (need design/build/extension — NOT mechanical)

20 capabilities are `requires-v1-completion` (V1C-01/02/05/06 and V1C-25 closed in the validation slice — see Pass Four). Each has a concrete action in
`v1-completion-programme.md` (source ADR, exact work, code paths, contracts/routes, tests/proofs,
UI semantic definition, stop condition, V2 assets). None is hidden inside a delivered count.

| Action | Capability                                                                              |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| V1C-01 | Tenant groups — ✅ CLOSED (proof:ui-semantic-groups)                                    |
| V1C-02 | Sub-organisations — ✅ CLOSED (proof:ui-semantic-sub-organisations)                     |
| V1C-03 | ABAC / Policy Decision Point (entitlement step only; quota Phase 2)                     |
| V1C-04 | Delegated administration roles (net-new; needs ADR)                                     |
| V1C-05 | Support-mode / break-glass (approval workflow proven)                                   |
| V1C-06 | Claim mapping — ✅ CLOSED (proof:ui-semantic-claim-mapping; live IdP external/ADR-0220) |
| V1C-07 | MFA + session policy + lockout (lockout/recovery surface; MFA E2E)                      |
| V1C-08 | Branding + theming (registry marks partial)                                             |
| V1C-09 | Custom domains / DNS / TLS / canonical (cutover unproven)                               |
| V1C-10 | Product catalog, plans, prices (no billing engine)                                      |
| V1C-11 | Subscriptions, invoices, payments, dunning (no engine; payment live-proof external)     |
| V1C-12 | PITR, retention, legal hold, residency (net-new)                                        |
| V1C-13 | Data governance: catalog/lineage/classification/PII/DSR (net-new)                       |
| V1C-14 | Tenant data import / export (net-new)                                                   |
| V1C-15 | Object storage file CRUD / quotas / lifecycle / AV (readiness-only today)               |
| V1C-16 | Workflow engine / approvals (scheduled-jobs delivered separately)                       |
| V1C-17 | Metrics + traces backend + dashboards                                                   | ✅ CLOSED (proof:metrics-prometheus; proof:dashboards) |
| V1C-18 | Dependency scanning as a hard gate                                                      |
| V1C-19 | Compliance reports / access reviews / evidence packs                                    |
| V1C-20 | Developer portal / SDK gen / sandbox (rate-limits delivered separately)                 |
| V1C-21 | Tenant lifecycle suspend / delete / export                                              |
| V1C-22 | Support tickets / customer health / announcements (net-new)                             |
| V1C-23 | Service catalog + provider integration generalisation                                   |
| V1C-24 | Tenant canonical domain cutover + redirects                                             |
| V1C-25 | i18n React provider/hook + message migration (hard gate)                                |

Plus **8 config-runtime bounded decisions** (`V1C-CONF-01..08`, decomposed from the former single
`V1C-PKG-CONFIG` by the §2 env/config audit — typed loading, schema validation, immutable projections,
secret references, app-specific config, direct-env-access restriction, test overrides, reload/restart).
The `config-runtime` package fate (keep-canonical vs remove) is the outcome.

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

1. **20 capability completions** (§A) — the runbook §0 invariant requires every capability resolved.
2. **10 deprecated zero-consumer package removals** — `domain-core, access-control, feature-workflow,
profile-configuration, security-auth, queue-runtime, search-runtime, notification-runtime,
worker-runtime, observability`. All now `delete-after-proof` in the path-map (was inconsistently
   `reuse-unchanged`/`archive-evidence`), all dropped from `v2-target-tree.txt`, all their scaffold
   tests retired. Gated on the orchestrator zero-consumer proof + the ADR-ACT-0289 review (2026-12-18).
   **Not executed in this change** (per instruction).
3. **8 config-runtime bounded decisions** — `V1C-CONF-01..08` (decomposed from `V1C-PKG-CONFIG`).

**Completion-blocker total: 30** = 18 capability completions + 10 package removals + 2 reopened V1C-17/V1C-18 capability completions (V1C-CONF-06 config decisions closed; V1C-01/02/05/06 and V1C-25 validation semantics closed)
(live truth: `npm run v2:readiness --json` `.completionBlockerCount`).

## What pass two got wrong (now fixed)

- **Count bucket aliasing**: pass two collapsed `refactor-behind-contract` (104) +
  `replace-retain-contract` (51, was 52) into a fake `reuse 1239` bucket. Buckets now match the
  path-map vocabulary exactly.
- **False `delivered-and-proven`**: 23 capabilities reclassified to `requires-v1-completion`,
  1 to `superseded-by-proven-canonical` (alerting/incidents → built-in canonical), and the
  contradictory `not-applicable-final`+`must close` on Serverless cleared.
- **Deprecated packages kept as V2 homes**: removed from the target tree, dispositioned
  `delete-after-proof`, scaffold tests retired.
- **Unresolved audited-commit placeholder**: replaced with the concrete audited SHA above; the
  separate freeze/cut commit is parameterised as `{{PINNED_V1_COMMIT}}`.

## Honest closure status

| Class                                      | Count | Blocks cut?         |
| ------------------------------------------ | ----- | ------------------- |
| delivered-and-proven                       | 54    | no                  |
| requires-v1-completion                     | 16    | **yes**             |
| superseded-by-proven-canonical             | 1     | no                  |
| not-applicable-final                       | 4     | no                  |
| config-runtime decisions (V1C-CONF-01..08) | 8     | **yes**             |
| deprecated package removals                | 10    | **yes** (execution) |

**The project is NOT ready to execute package deletion or cut V2** until the §A completions and the
§C blockers close and `npm run v2:readiness` exits `0`.
