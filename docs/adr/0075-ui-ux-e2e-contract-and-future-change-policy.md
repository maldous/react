# ADR-0075: UI/UX E2E contract and future-change policy (environment-appropriate confidence ladder)

- Status: Accepted
- Date: 2026-06-14
- Deciders: Architecture owner / platform
- Related: ADR-0025 (Playwright E2E baseline), ADR-0026 (i18n), ADR-0029 (FQDN tenancy),
  ADR-0030 (forward-auth PEP), ADR-0035 (observability label policy), ADR-0058 (entitlements),
  ADR-ACT-0284 (logging + distributed tracing). Supersedes nothing.

## Context

E2E testing must give **environment-appropriate confidence**: dev/test/staging/prod each
prove the platform to an incrementally higher bar, and `make all` must fail whenever the
platform cannot be proven end-to-end at the correct confidence level for a stage. The stage
model (`env/stage-policy.yaml`, `scripts/stages/run-stage.sh`, `scripts/tests/run-env-tests.sh`)
already encodes per-stage required test groups; this ADR adds the **machine-readable contracts
and validators** that make coverage honest and enforceable, and a **future-change policy** so
the suite survives UI/UX redesigns without wholesale rewrites.

Two failure modes this ADR closes:

1. **Hidden / missing coverage.** A delivered or locally-proven capability, an admin route, a
   nav item, or a clickthrough policy entry could exist with no E2E coverage and nobody would
   know. Tests could exist with no declared intent.
2. **Brittle coupling to the current visual design.** Tests pinned to CSS classes, DOM depth,
   visual position, or incidental text break on cosmetic redesigns — punishing good refactors
   and eroding trust in the suite.

## Decision

### 1. Machine-readable contracts (the spine)

Three registries under `e2e/` are the single source of truth for what E2E must cover. They are
validated against the live platform inventories (USF registry, capability registry, admin nav,
BFF routes, clickthrough policy, role/permission model) by tools that fail `make all` on drift.

- **`e2e/suite-registry.json`** — every suite/scenario: `id`, `stageMin`, `authMode`,
  `destructive`, `surfaces`, `requiredCapabilities`, `expectedLogs`, `expectedMetrics`,
  `expectedTraces`, `expectedSentryEvents`, `failureModes`, `owner` (ADR/evidence). No test
  file may exist without a registry entry; no delivered/locally-proven capability may lack
  coverage unless explicitly `exempt` with a reason.
- **`e2e/persona-registry.json`** — the persona/account matrix: roles, permissions,
  deniedPermissions, entitlements, quotas, rate limits, accessibility profile, and the
  expected/forbidden nav/routes/API/clickthrough surface per persona and stage. Drives
  positive **and** negative authorization tests and accessibility coverage.
- **`e2e/ui-contract.json`** — per UI surface: `surfaceId`, owning capability, route or
  discovery rule, supported personas, required permissions/entitlements, expected primary /
  secondary / destructive actions, safe stage coverage, accessibility + observability
  expectations, `allowedSelectors`, `forbiddenBrittleSelectors`, and migration/deprecation
  status. This is the product-intent contract that survives redesigns.

### 2. Selector & coupling policy (resilience to redesign)

E2E **must not** rely on: CSS class names, DOM depth, visual position, exact text where the
wording is not contractual, current menu grouping, current breakpoint, or component-library
internals. E2E **must** prefer: accessible roles, accessible names (where the user-facing text
is intentional product copy), route/capability/persona/entitlement metadata, design-system
component contracts, and `data-testid` **only where declared** in `ui-contract.json`
(`allowedSelectors`). `forbiddenBrittleSelectors` patterns are rejected by the validator.

The distinction is **product intent vs implementation detail**: a contract-driven test asserts
"a tenant-admin can invite a member and the action is logged"; it must not assert "the button
is the third `<button>` in `.toolbar`". Cosmetic/layout-only changes must not require test
rewrites; product-behaviour changes must update the contract in the same PR.

### 3. Two test layers

1. **Contract-driven tests** — prove required journeys, permissions, entitlements,
   accessibility, logging, and observability still work regardless of visual redesign. Driven
   by the registries.
2. **Discovery-driven tests** — a per-stage crawler discovers visible nav/clickable surfaces
   and diffs them against `ui-contract.json`, forcing the team to either add coverage, mark a
   surface intentionally out of scope, or record future work. Detects orphaned routes,
   untested actions, hidden-but-accessible routes, and newly introduced surfaces.

### 4. Validators (enforcement)

- `npm run e2e:coverage:validate` — fails when a delivered/locally-proven capability, an admin
  route, an admin nav item, a clickthrough policy entry, or a proof script has no mapped E2E
  scenario (minus declared exemptions); writes an honest coverage report. Missing/deferred/
  mock-only capabilities do not fail but must appear honestly.
- `npm run e2e:personas:validate` — fails when a role/permission/entitlement/accessibility
  profile lacks positive **and** negative coverage, when a scaffold account is missing from
  staging/prod real-auth provisioning, or when a UI-hidden-but-API-accessible gap is declared
  without a denial test.
- `npm run e2e:ui:contract:validate` — fails when a route/admin page/action exists without
  declared intent, a permission-gated surface lacks a negative test, a destructive action lacks
  a stage-safe rule, a surface lacks an accessibility contract, a redesign removes/renames a
  contract without a migration note, or a test uses a forbidden brittle selector.

### 5. Future-change policy (mandatory)

Every future UI/UX change **must**, in the same PR: update `e2e/ui-contract.json`, persona
coverage, accessibility coverage, and E2E evidence under `docs/evidence/e2e/`. Deprecated UI
paths are removed from coverage intentionally via `migration` status (`active` → `deprecated`
→ `removed`) with a migration note. The validators are wired into `make all` so an
out-of-contract change cannot merge green.

## Consequences

- `make all` fails on missing/dishonest coverage and on brittle-selector violations — coverage
  becomes a hard gate, not a hope.
- The suite is resilient to redesign (intent-driven) but strict about behaviour, authorization,
  accessibility, and observability.
- New cost: every product-behaviour change carries a contract update. This is intentional — it
  keeps the contract and the product in lockstep.
- Delivered incrementally (ADR-ACT-0285): the registries + validators are the spine; the
  clickability crawler, observability-correlation harness, failure-path/root-cause proofs,
  Grafana/Sentry validation, and persona/accessibility execution land in subsequent phases,
  with the coverage report honestly showing what is not yet covered at each step.
