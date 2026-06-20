# Semantic Reference Harness

Non-shipping tooling that renders **capability semantics** — not product screens — so a UI
semantic gap can be closed with a machine-readable definition + working MSW fixtures + a passing
headless Playwright journey, instead of a hand-built throwaway screen.

It reads harness-enabled capability records from
`docs/v2-foundation/ui-capability-model.json` (the single source of truth), validates them, and
renders forms / tables / details / states **generically**. There are no per-capability React
components — a capability is closed by adding a record + fixtures + a journey, never React code.

## Selection protocol

```text
/?capability=<key>&persona=<personaId>&state=<dataState>
```

- `capability` — a harness-enabled `capabilityKey` (e.g. `groups`)
- `persona` — a declared persona; a persona without the read permission gets `ForbiddenState`
- `state` — one of: `loading`, `empty`, `loaded`, `submitting`, `success`, `validationError`,
  `forbidden`, `serverError`, `degraded`

MSW intercepts the capability's **declared BFF contracts** in-browser, so the harness is fully
self-contained — no platform-api or Compose is required.

## Layout

| Path                                   | Responsibility                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/load-capability.mjs`              | select harness-enabled records from the model (pure)                                 |
| `src/validate-definition.mjs`          | the harness contract validator — 9 fail conditions (pure)                            |
| `src/capability-controller.mjs`        | resolve axes → view model, permission/fixture resolution (pure)                      |
| `src/msw/handlers.mjs`                 | build MSW handlers from declared contracts + fixtures                                |
| `src/renderers/*`                      | generic form / table / detail / state renderers (reuse `@platform/ui-design-system`) |
| `src/permissions/capability-guard.tsx` | read-permission boundary → `ForbiddenState`                                          |
| `src/app.tsx`, `src/main.tsx`          | the single generic application shell                                                 |
| `tests/*.test.mjs`                     | node-test coverage of the pure logic + a live run over the real model                |
| `playwright/*.spec.ts`                 | per-capability headless journeys (the executable proof)                              |

## Commands

```bash
npm run ui:harness        # dev server (vite)
npm run ui:harness:test   # node --test: validator + controller + live-model checks
npm run ui:harness:e2e    # playwright headless journeys
```

## Enforcement

- **Schema** — `docs/v2-foundation/ui-definition.schema.json` declares the `harness` block.
- **Consistency gate** — v2-readiness rule **R20** (`r20-harness-semantics`) runs
  `validate-definition` over every harness-enabled capability in the model.
- **Boundary** — Semgrep `no-harness-import-in-product` forbids product code (`apps/`, `packages/`,
  `services/`) from importing this harness; the dependency direction is harness → model only.

This harness is **not** part of any shipped artifact.
