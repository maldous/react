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
| `@tanstack/react-router` | Type-safe SPA routing | Yes — do not use React Router |

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
| `framer-motion` | Sparingly — page transitions, polish | Yes (limited scope) |

### Testing

| Library | Role | Binding |
| --- | --- | --- |
| `vitest` | Test runner | Yes |
| `@testing-library/react` | Component testing | Yes |
| `@testing-library/user-event` | User interaction simulation | Yes |
| `msw` | API mocking (test + browser) | Yes |
| axe/vitest-axe | Accessibility checks | Yes — added with test harness |

## Deferred libraries

| Library | Reason for deferral |
| --- | --- |
| ECharts | Deferred until complex dashboard requirements established |
| AG Grid | Deferred until Excel-like editing / large-scale pivoting needed; requires ADR |
| Command palette (global) | cmdk selected; global implementation deferred post-first-slice |
| TanStack Start | SSR model; requires separate ADR |
| Next.js | SSR model; not for ADR-ACT-0008 |
| Framer Motion (full) | Allowed sparingly; full adoption requires architectural review |

## Rejected libraries

| Library | Reason for rejection |
| --- | --- |
| Material UI | Transfers design-system ownership to third party; constrained visual identity |
| Ant Design | Same as MUI; no open-code ownership |
| Redux / Redux Toolkit | Over-engineered for feature-scoped state; TanStack Query + Zustand preferred |
| React Router | Lacks full type safety for params and search; TanStack Router preferred |

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

## First-slice expectations

The first vertical slice (ADR-ACT-0008) must include:

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
| open-code component maintenance | Maintainer ownership of `packages/ui`; no bulk third-party updates |
| Accessibility regressions | axe integration in test harness (ADR-ACT-0097); mandatory before merge |
| Form/contract schema divergence | Use `z.extend` / `z.merge` to compose, not duplicate |
| AG Grid creep | Explicit ADR required before introduction; TanStack Table covers initial needs |

## Validation commands run

```text
npm run format:check    → All matched files use Prettier code style!
npm run lint:md         → 0 errors
npm run lint            → 0 problems
npm run tsc:check       → 0 errors
npm run test:coverage   → 180 tests, 0 failures
npm run sonar:clean     → Quality gate OK
npm run audit:deps      → 0 vulnerabilities
npm run audit:osv       → 0 issues
npm run compose:config  → valid
npm run compose:config:all → valid (all profiles)
node orchestrator all --strict → 6/6 passed
```

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.** This evidence establishes the complete frontend platform baseline required before slicing begins.
