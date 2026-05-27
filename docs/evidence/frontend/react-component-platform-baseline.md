# React component platform baseline evidence

## Summary

Ratified frontend platform stack before the first vertical slice (ADR-ACT-0008). Governed by ADR-0019. All library selections are binding until superseded by a future ADR.

## Governance

- ADR-0019 (accepted)
- ADR-ACT-0094 (Done — ADR created)
- ADR-ACT-0095 (Open — packages/ui primitives)
- ADR-ACT-0096 (Open — app shell providers)
- ADR-ACT-0097 (Open — frontend test harness)
- ADR-ACT-0098 (Open — DataTable shell)
- Committed: 2026-05-28

## Selected libraries

### Core

| Library | Role | Binding |
| --- | --- | --- |
| React 19 | UI runtime | Yes |
| Vite 6 | Build tool / dev server | Yes |
| TypeScript 6 | Type system | Yes |

### Routing

| Library | Role | Binding |
| --- | --- | --- |
| `@tanstack/react-router` | Type-safe SPA routing | Yes — do not use React Router as baseline |

### Server and cache state

| Library | Role | Binding |
| --- | --- | --- |
| `@tanstack/react-query` | Server state / query cache | Yes — no custom API cache |

### Local and cross-component UI state

| Library | Role | Binding |
| --- | --- | --- |
| React `useState`/`useReducer` | Component-local state | Yes |
| `zustand` | Cross-component UI state only | Yes — no Redux |

### Forms and validation

| Library | Role | Binding |
| --- | --- | --- |
| `react-hook-form` | Form state and submission | Yes |
| `zod` | Schema definition and validation | Yes |
| `@hookform/resolvers` | Zod integration for RHF | Yes |

### UI component foundation

| Library | Role | Binding |
| --- | --- | --- |
| `react-aria-components` | Accessible interaction primitives | Yes |
| `tailwindcss` | Styling utilities | Yes |
| `class-variance-authority` | Typed variant definitions | Yes |
| `tailwind-merge` | Safe class override merging | Yes |
| `clsx` | Conditional class composition | Yes |
| `lucide-react` | Icon set | Yes |

### Data tables

| Library | Role | Binding |
| --- | --- | --- |
| `@tanstack/react-table` | Headless table logic | Yes |
| `@tanstack/react-virtual` | Windowed rendering | Yes |

### Supplementary

| Library | Role | Binding |
| --- | --- | --- |
| `sonner` | Toast notifications | Yes |
| `cmdk` | Command palette / searchable menus | Yes |
| `recharts` | Basic charts | Yes |
| `date-fns` | Date arithmetic and formatting | Yes |
| `framer-motion` | Page transitions and polish | Yes (limited scope; reduced-motion required) |

### Testing

| Library | Role | Binding |
| --- | --- | --- |
| `vitest` | Test runner | Yes |
| `@testing-library/react` | Component testing | Yes |
| `@testing-library/user-event` | User interaction simulation | Yes |
| `msw` | API mocking (test + browser) | Yes |
| axe/vitest-axe | Accessibility checks | Yes — added with test harness (ADR-ACT-0097) |

## Library classification — deferred and conditional

Libraries in this section have a defined introduction path. "Deferred" means the baseline choice is sufficient; introduction requires the stated criteria to be met.

### Deferred — introduce per-feature without formal ADR barrier

These are natural progression options once baseline requirements are exceeded:

| Library | Current baseline | Trigger for introduction |
| --- | --- | --- |
| ECharts | Recharts | Charting requirements exceed Recharts capabilities (complex transforms, server-side rendering of large datasets, candlestick/financial charts) |
| XState | Zustand | Complex UI state machines needed: multi-step wizards, multi-stage approval workflows, state-machine-driven form flows. No formal ADR required — introduce per-feature once ADR-ACT-0097 test harness is in place |
| Storybook | Inline docs | packages/ui component documentation and visual regression testing; introduce after ADR-ACT-0095 establishes the primitive set |

### Deferred — formal ADR required before adoption

These require architectural review before introduction:

| Library | Current baseline | Criteria requiring ADR |
| --- | --- | --- |
| AG Grid | `@tanstack/react-table` | Excel-like cell editing, column pivoting, server-side row model for >100K rows, or enterprise licensing acceptance |
| Playwright | Vitest + MSW | E2E test harness; introduce after first vertical slice proves the MSW-mocked integration pattern |

### Baseline-prohibited — ADR required for targeted exception

These are not adopted as baseline design systems. A targeted ADR may approve a specific component from these libraries for a feature with a clear product requirement (e.g., a complex data visualisation widget not covered by `packages/ui`). This is an exception path, not a direction change.

| Library | Reason baseline is prohibited | Exception path |
| --- | --- | --- |
| Material UI (`@mui/material`) | Design system ownership moves to third party; visual identity is externally controlled | Targeted ADR approving a specific component for a specific product need |
| Ant Design (`antd`) | Same as MUI | Same |

### Not selected as baseline — valid alternative

These are valid libraries that were not chosen as the baseline. They remain candidates if the chosen baseline has critical limitations.

| Library | Why not selected | Conditions for reconsideration |
| --- | --- | --- |
| React Router | TanStack Router provides stronger type safety for params and search; TanStack Router was the superior fit | If TanStack Router has critical bugs, breaking API changes, or inadequate community support that cannot be resolved; requires team decision |

### Rejected — incorrect fit for this architecture

These are incompatible with the chosen state/domain model and must not be introduced without a clear architectural reason:

| Library | Why rejected |
| --- | --- |
| Redux / Redux Toolkit | Server/cache state is owned by TanStack Query; cross-component UI state is owned by Zustand; global domain store would violate ADR-0001 hexagonal boundaries. No legitimate use case remains. |

### Architecturally incompatible — requires superseding foundational ADRs

These are not "deferred" — they represent a different architectural model. Adoption requires revising ADR-0003 (Vite SPA + BFF) and ADR-0013 (API boundary), not just a library decision:

| Library | Why incompatible |
| --- | --- |
| Next.js | SSR/file-based routing model; replaces BFF pattern with co-located API routes; conflicts with ADR-0003 |
| TanStack Start | Same — SSR model with file-based routing; conflicts with ADR-0003 |

## Component layer table

| Layer | Package | Allowed imports |
| --- | --- | --- |
| App shell | `apps/react-enterprise-app` | `packages/features/*`, `packages/ui`, `packages/contracts/*`, platform libs |
| Feature packages | `packages/features/*` | `packages/ui`, `packages/contracts/*`, `packages/domain/*` (boundary-compliant) |
| UI primitives | `packages/ui` | React, React Aria, Tailwind utils, lucide-react, sonner, `@tanstack/react-table` |
| Contracts | `packages/contracts/*` | Zod, no React |
| Domain | `packages/domain/*` | No React, no adapters, no UI |
| Adapters | `packages/adapters-*` | Server/infra libs only; must NOT be imported by React packages |

## Forbidden import patterns

| From | Must NOT import |
| --- | --- |
| Any React package | `packages/adapters-*`, Node-only modules |
| `packages/ui` | `packages/features/*`, `packages/domain/*`, `packages/contracts/*` (except type-only ADR exception) |
| `packages/domain/*` | React, UI libs, adapters, router/query/form libs |
| `packages/contracts/*` | React UI, adapters, app packages |
| `apps/react-enterprise-app` | `packages/adapters-*`, server runtime packages, `tools/architecture` |

## UI primitives required before first slice

To be implemented in `packages/ui` (ADR-ACT-0095):

**Input / form:** Button, Input, Textarea, Label, Select, Checkbox, RadioGroup, Switch

**Overlay:** Dialog, Popover, Tooltip, DropdownMenu

**Navigation:** Tabs

**Layout / display:** Card, Badge, Alert, Toast, FormField, PageLayout, SectionHeader

**State feedback:** LoadingState, ErrorState, EmptyState

**Data:** DataTable shell

## First-slice expectations (ADR-ACT-0008)

1. At least one component test using Vitest + React Testing Library
2. At least one API-mocked feature test using MSW
3. At least one form using React Hook Form + Zod
4. At least one route using TanStack Router
5. At least one query using TanStack Query
6. All components using `packages/ui` primitives where applicable
7. No direct adapter imports in any React package

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| TanStack Router v1 API changes | Pin major version; subscribe to changelogs; bounded to `apps/` |
| Open-code component maintenance | Maintainer ownership of `packages/ui`; no bulk third-party updates |
| Accessibility regressions | axe integration in test harness (ADR-ACT-0097); mandatory before merge |
| Form/contract schema divergence | Use `z.extend` / `z.merge` to compose, not duplicate |
| AG Grid creep | Explicit ADR required before introduction; criteria documented |
| Complex state machine ad-hoc solutions | XState is the approved choice when state machine complexity is needed |

## Validation commands run

```text
npm run format:check      → All matched files use Prettier code style!
npm run lint:md           → 0 errors
npm run lint              → 0 problems
npm run tsc:check         → 0 errors
npm run test:coverage     → 180 tests, 0 failures
npm run sonar:clean       → Quality gate OK
npm run audit:deps        → 0 vulnerabilities
npm run audit:osv         → 0 issues
npm run compose:config    → valid
npm run compose:config:all → valid (all profiles)
node orchestrator all --strict → 6/6 passed
```

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.** This evidence establishes the complete frontend platform baseline required before slicing begins.
