# Whole-Project ADR Compliance Review — 2026-06-11

Manual ADR-by-ADR compliance review of the entire repository against all
*Accepted* Architecture Decision Records, anchored on the repo's canonical
mechanical enforcers plus targeted source inspection of the constraints those
enforcers do not cover.

- **Reviewer:** Claude Code (manual ADR-by-ADR, no subagents)
- **Scope:** entire codebase vs. 44 Accepted ADRs (0001–0045, no ADR-0018; ADR-0000 is the template)
- **Branch:** `main` (working tree, including the ADR-ACT-0214 tooling slice)

## Method

1. Indexed all ADRs and confirmed every ADR 0001–0045 is `Accepted`.
2. Ran the three canonical enforcers as the objective backbone.
3. Manually inspected the semantic constraints the enforcers cannot mechanically
   catch (raw error throwing in policy layers, GraphQL client boundary, committed
   secrets/state, Loki adapter isolation, BFF-only React data access).

## Objective backbone (hard evidence)

| Enforcer | Command | Result | ADR coverage |
|---|---|---|---|
| Architecture orchestrator | `node tools/architecture/orchestrator/src/index.mjs all --no-reports --strict` | **11/11 gates pass**, exit 0 | 0001–0012, 0024, 0026, action-register |
| Semgrep constraint gate | `npm run semgrep:gate` | **0 findings / 188 files**, 6 ERROR rules, exit 0 | constraints 2,3,4,5,7 + secret-in-log/audit |
| Architecture test suite | `npm run test:architecture` | **781/781 pass**, 0 fail | 0011, 0012, import boundaries |

Orchestrator gates that passed: `validate-package-metadata`, `validate-source-imports`,
`generate-package-readmes`, `generate-package-inventory`, `generate-lifecycle-reports`,
`validate-lifecycle-evidence`, `validate-slice-readiness`, `validate-i18n`,
`validate-pipeline-composition`, `validate-compose-ports`, `validate-action-register`.

`validate-action-register` passing confirms constraint #9 (no `Done` row without
evidence) is satisfied across the register.

## Per-group verdict

| ADR group | ADRs | Verdict | Basis |
|---|---|---|---|
| Architecture & packaging | 0001–0012, 0024 | ✅ Compliant | import boundaries machine-clean; metadata/README/inventory/lifecycle/slice gates pass; 781 tests |
| API & data boundaries | 0013, 0014, 0015, 0028 | ✅ Compliant | no GraphQL client/schema in SPA or domain; admin uses documented REST-over-BFF (relative `fetch` with `credentials:"include"`), not a bypass |
| Frontend & i18n | 0019, 0026 | ✅ Compliant | `validate-i18n` passes; semgrep `no-server-runtime-import-in-spa` = 0 |
| Observability & logging | 0020, 0035 | ✅ Compliant | no OTel SDK in `platform-observability`; no pino in pure layers; Loki adapter-isolated; SPA `admin-logs-client.ts` documents the boundary |
| Identity / auth / tenancy / control-plane | 0021, 0022, 0029, 0030, 0036–0045 | ✅ Compliant (static) | secret-in-log/audit semgrep = 0; no tracked secrets; pure policy uses `platform-errors`; active slice (ACTION-REGISTER 0204–0214), slice-readiness + action-register pass |
| Infra / local-dev / testing | 0016, 0017, 0023, 0025, 0027, 0031, 0032, 0033, 0034 | ✅ Compliant (static) | `validate-compose-ports` + `validate-pipeline-composition` pass; ADR-0016 baseline strengthened by the new Semgrep hard gate |

## Constraint checks (CLAUDE.md "Critical constraints")

| # | Constraint | Result |
|---|---|---|
| 1 | No BFF bypass from React | ✅ admin data via relative BFF paths only |
| 2 | No DB/Redis/Keycloak SDK/etc. in React | ✅ clean |
| 3 | No adapter imports in domain/feature/UI/contract | ✅ semgrep + grep clean |
| 4 | No pino in pure layers | ✅ clean |
| 5 | No OTel SDK in `platform-observability` | ✅ clean |
| 6 | No raw `Error` for expected failures | ✅ no raw `throw new Error` in pure policy packages (use `platform-errors`); raw throws only in runtime/adapter packages (programmer/invariant errors) |
| 7 | No `console.*` in app/BFF/adapter runtime | ✅ clean |
| 8 | No committed secrets/state files | ⚠️ see Finding 1 |
| 9 | No `Done` rows without evidence | ✅ `validate-action-register` passes |
| 10 | No unverified prod/live claims | ✅ see Note 3 — no live verification claimed |

## Findings

### ⚠️ Finding 1 — Constraint #8 gitignore gap (RESOLVED in this review)
Session-generated agent-tooling DB/state artifacts were untracked but **not**
gitignored: `.claude/memory.db`, `.swarm/` (memory.db/-shm/-wal/schema.sql),
`agentdb.rvf`, `agentdb.rvf.lock`, `ruvector.db`. A `git add -A` would have staged
them. **Fixed** by appending an "Agent tooling state/DB artifacts" block to
`.gitignore`; verified all paths now return `git check-ignore` = ignored.

### ℹ️ Note 2 — Semgrep glob anchoring (RESOLVED in this review)
All 6 rules in `tools/semgrep/rules.yml` emitted Semgrepignore-v2 deprecation
warnings (`apps/...` → `**/apps/...`). **Fixed** by prefixing every `apps/` and
`packages/` include glob with `**/` (permanently-unanchored form). Re-ran
`semgrep:gate`: warnings gone, still 0 findings / 6 rules. Behavior unchanged;
forward-compatible with the upcoming Semgrep glob-anchoring change. This is a
cosmetic forward-compat fix within the scope of ADR-ACT-0214 (no behavior change).

### ℹ️ Note 3 — Static review, not live-verified
This review is static + gate-based. E2E, compose runtime, and production smoke
(ADR-0025 / 0032 / 0034) were **not** executed; no live or production compliance
is claimed (constraint #10). Deep auth-redaction runtime behavior (ADR-0043 secret
redaction, ADR-0040 audit) is gate-covered but its live proof requires the
`auth-redaction-review` skill + `proof:auth-settings` against Keycloak.

## Bottom line

**No ADR violations found.** Every machine-enforceable constraint is green, and
targeted inspection of the constraints the gates do not cover is clean. The two
actionable items surfaced (gitignore gap, Semgrep glob anchoring) were both fixed
during the review.
