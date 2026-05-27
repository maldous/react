# ADR-0019: Define React component platform and frontend integration stack

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture)
- ADR-0002 (bounded contexts — experience domain)
- ADR-0003 (modular monorepo)
- ADR-0005 (package metadata)
- ADR-0007 (repository layout)
- ADR-0013 (client-facing API boundary)
- ADR-0014 (transactional data ownership)
- ADR-0016 (quality gate baseline)

## Context

The first vertical slice (ADR-ACT-0008) will produce the first user-facing feature. Without a ratified frontend stack, the slice work would implicitly define the component architecture, routing model, state management pattern, and test approach through local choices that become de-facto standards.

This ADR chooses the internal React component model, routing, server/cache state, local UI state, forms, schema validation, UI primitives, data grids, testing, and supplementary libraries before slice work begins.

The platform uses a Vite-built React SPA shell (`apps/react-enterprise-app`) with a separate Node BFF/API runtime. The React app must not import adapters directly — all server interaction goes through the approved API boundary.

## Stakeholder concerns

- **Engineering:** Stack must support type-safe navigation, accessible components, and testable feature packages without heavyweight ceremony.
- **Product:** UI components must deliver accessible, polished UX without introducing a third-party design system ownership burden.
- **Security:** Form validation must not duplicate or weaken contract schemas; BFF must validate input before calling use cases.
- **Architecture:** Package boundaries defined by ADR-0001/0002/0013 must not be violated by frontend library choices.
- **Testing:** First slice must include component tests and API-mocked feature tests from day one.
- **Accessibility:** Accessible interaction must be baseline, not a post-release concern.

## Decision drivers

1. Type safety end-to-end: route params, search params, query results, form data.
2. Package boundary integrity: features, UI, contracts, and domain must not leak across layers.
3. Open-code component ownership: platform owns its UI primitives; no vendor design-system lock-in.
4. Accessible by default: complex interaction behaviour (focus, ARIA, keyboard) must not be hand-rolled.
5. Testable from day one: testing harness must be in place before the first slice ships.
6. Composable, not monolithic: no global stores for domain state; state lives where it is needed.

## Options considered

### Option A: React Router + Redux + Material UI

Classic enterprise React stack.

Pros:

- Widely known.
- Large community.

Cons:

- React Router v6+ lacks full type safety for params/search.
- Redux is over-engineered for feature-scoped state.
- Material UI's design system constrains visual identity.
- MUI components require prop-level theming overrides; not open-code.

### Option B: Next.js full-stack

Pros:

- Server rendering; file-based routing.

Cons:

- ADR-0003 established a Vite SPA shell with a separate BFF. Next.js would replace the BFF pattern with Next.js API routes, creating an architectural split in the platform model.
- SSR changes caching, hydration, and adapter boundary patterns.
- Adoption requires superseding ADR-0003 (modular monorepo + BFF) and ADR-0013 (API boundary); it is not a simple library addition. Not deferred — architecturally incompatible with the current model until those ADRs are revisited.

### Option C: TanStack ecosystem + React Aria + open-code UI (chosen)

TanStack Router, TanStack Query, TanStack Table/Virtual, Zustand, React Hook Form, Zod, React Aria Components, Tailwind CSS, open-code component model.

Pros:

- TanStack Router provides full type-safe routing.
- TanStack Query is the standard for server state in React without Redux overhead.
- React Aria provides accessible primitives without visual opinion.
- Open-code component model: platform owns component source.
- Zustand is minimal — no reducer boilerplate.
- Zod unifies contract validation and form validation schemas.

Cons:

- TanStack Router is newer; API stabilised in v1.
- Requires more upfront component work than adopting MUI out of the box.

## Decision

The platform adopts the following frontend stack. All decisions take effect before ADR-ACT-0008 first vertical slice. Each section is binding unless superseded by a future ADR.

---

### 1. Core distribution model

- Vite-built React 19 SPA (`apps/react-enterprise-app`)
- Separate Node BFF/API runtime (not co-located in the React app)
- React app must not import `packages/adapters-*`, server-only packages, or Node-only modules

---

### 2. Routing — TanStack Router

```text
@tanstack/react-router
```

Rules:

- All navigation uses TanStack Router; no programmatic `window.location` manipulation.
- Route params and search params are typed at definition time.
- Layout routes wrap authenticated/shared shells.
- Route loaders may prefetch data; loader results are typed.
- Search params own durable table/filter state where applicable (bookmarkable URLs).
- Do NOT use React Router as baseline.
- Do NOT use Next.js or TanStack Start for ADR-ACT-0008.

---

### 3. Server and cache state — TanStack Query

```text
@tanstack/react-query
```

Rules:

- All server state goes through TanStack Query (queries and mutations).
- Query keys are owned by feature packages, not the app shell.
- Mutations call the approved API boundary; on success, invalidate affected queries.
- No server/cache state in Zustand.
- No custom global API cache.

---

### 4. Local and cross-component UI state — React local state + Zustand

```text
zustand
```

Rules:

- Component-local state uses `useState`/`useReducer`.
- Cross-component, non-server UI state uses Zustand:
  - sidebar open/closed
  - theme preference
  - selected shell navigation state
  - transient wizard state
  - non-server UI preferences
- Do NOT use Redux as baseline.
- Do NOT create a global domain store.
- Domain data is always owned by TanStack Query.

---

### 5. Forms — React Hook Form + Zod

```text
react-hook-form
zod
@hookform/resolvers
```

Rules:

- All forms use React Hook Form.
- Form validation schemas are Zod schemas.
- Feature form schemas may compose or reference contract schemas.
- No duplicate validation if a contract schema already covers the shape.
- Forms use shared `FormField` primitives from `packages/ui`.
- Form submission calls feature mutation hooks; features do not call adapters directly.

---

### 6. Contract and schema validation — Zod

```text
zod
```

Rules:

- `packages/contracts/*` define request/response DTO schemas as Zod schemas.
- BFF validates incoming requests with Zod before calling use cases.
- Client-side form schemas may compose contract schemas via `z.merge` / `z.extend`.
- Adapters must not expose raw database shapes to React.

---

### 7. UI component foundation

```text
react-aria-components
tailwindcss
class-variance-authority
tailwind-merge
clsx
lucide-react
```

Rationale:

- **React Aria Components** — Accessible, high-quality interaction behaviour (focus, keyboard, ARIA). WAI-ARIA patterns are implemented correctly without hand-rolling.
- **Tailwind CSS** — Styling primitives; utility-first; purge-safe.
- **class-variance-authority (cva)** — Type-safe component variant definitions.
- **tailwind-merge** — Safe class merging for overrides.
- **clsx** — Conditional class composition.
- **lucide-react** — Icon set; tree-shakable, consistent visual style.

---

### 8. Internal component distribution model — open-code

`packages/ui` owns all reusable UI primitives using an open-code model:

Rules:

- Components are source code in the repository — not black-box wrappers around a third-party suite.
- Upstream component patterns (from shadcn/ui or React Aria examples) may be copied and adapted; final code is owned by `packages/ui`.
- Component APIs must be stable, typed with TypeScript, and documented in JSDoc.
- Every interactive component must implement accessibility states (disabled, focused, invalid).
- Do NOT adopt Material UI or Ant Design as the **baseline design system** for `packages/ui`. They are baseline-prohibited: the open-code model takes precedence. A targeted ADR may approve adopting a specific MUI or Ant Design component for a feature with a clear product requirement (e.g., a complex date picker or complex data visualisation widget not covered by the component set) — this is an exception, not a direction change.

---

### 9. UI primitives to establish before first slice

`packages/ui` must define or stub the following before ADR-ACT-0008:

**Input / form:** Button, Input, Textarea, Label, Select, Checkbox, RadioGroup, Switch

**Overlay:** Dialog, Popover, Tooltip, DropdownMenu

**Navigation:** Tabs

**Layout / display:** Card, Badge, Alert, Toast, FormField, PageLayout, SectionHeader

**State feedback:** LoadingState, ErrorState, EmptyState

**Data:** DataTable shell (column/row API defined; rendering delegated to feature packages)

Scope boundary: Do not build feature-specific components in `packages/ui`. Do not build a full design system.

---

### 10. Data grids and tables — TanStack Table + TanStack Virtual

```text
@tanstack/react-table
@tanstack/react-virtual
```

Rules:

- `packages/ui` exposes a `DataTable` shell (headless).
- Feature packages define columns, row actions, and cell renderers.
- Server-side pagination, filtering, and sorting are preferred for enterprise data volumes.
- Durable table state (page, sort, filters) lives in TanStack Router search params.
- Transient table state (column resize, row expansion) lives in feature-local state.
- Do NOT use AG Grid initially. AG Grid may be introduced by ADR if enterprise grid requirements require Excel-like editing, pivoting, grouping at scale, or enterprise licensing is accepted.

---

### 11. Charts — Recharts

```text
recharts
```

Rules:

- Recharts is the baseline charting library.
- Charts are feature-owned unless an obvious general primitive exists.
- ECharts is deferred until complex dashboard requirements are established.

---

### 12. Search / command menu — cmdk

```text
cmdk
```

Rules:

- `cmdk` is used for command palette and searchable command menus.
- Global command palette implementation is deferred until after first slice unless needed by ADR-ACT-0008.

---

### 13. Notifications — Sonner

```text
sonner
```

Rules:

- Sonner is the toast/notification library.
- `packages/ui` exposes a `ToastProvider`/`Toaster` wrapper.
- Do not use multiple notification systems.

---

### 14. Dates and time — date-fns + React Aria

```text
date-fns
react-aria-components (date/time components)
```

Rules:

- `date-fns` for date arithmetic, formatting, and locale utilities.
- `Intl` APIs for locale-aware formatting where practical.
- React Aria date/time components for interactive date fields, pickers, and calendars.
- Do not invent custom date picker behaviour.

---

### 15. Accessibility — required baseline

Rules:

- React Aria is preferred for complex interactive components (dialogs, menus, date pickers, comboboxes).
- Keyboard navigation must work for all interactive surfaces.
- Focus management must be explicit for overlays and modal dialogs.
- Visible focus indicators are required.
- All inputs must have programmatic labels.
- Dialogs, menus, and popovers must follow WAI-ARIA patterns.
- Accessibility audit tooling (axe or equivalent) must be added to the frontend test harness (ADR-ACT-0097).

---

### 16. Frontend testing — Vitest + React Testing Library + MSW

```text
vitest
@testing-library/react
@testing-library/user-event
msw
```

Rules:

- Vitest is the test runner for all frontend unit and component tests.
- React Testing Library tests behaviour, not implementation.
- `@testing-library/user-event` simulates real user interaction.
- MSW intercepts API requests in tests and browser (service worker mode) for realistic mocking.
- The frontend test harness must be created before ADR-ACT-0008 (ADR-ACT-0097).
- The first vertical slice must include at least one component test and one API-mocked feature test.
- Accessibility checks (axe/vitest-axe or equivalent) are added with the test harness.

---

### 17. Animation — Framer Motion (sparingly)

```text
framer-motion
```

Rules:

- Framer Motion is allowed for: page transitions, drawer/dialog polish, list item transitions.
- No animation dependency in `packages/domain`, `packages/features`, or `packages/contracts`.
- All motion must respect `prefers-reduced-motion`.
- Animation is not a required part of the first slice.

---

### 18. Package boundary rules

**apps/react-enterprise-app** may import:

- `packages/features/*`
- `packages/ui`
- `packages/contracts/*`
- Approved frontend platform packages (TanStack Router, TanStack Query, Zustand, Sonner)

**apps/react-enterprise-app** must NOT import:

- `packages/adapters-*`
- Server-only packages (`packages/api-runtime`, `packages/worker-runtime`, etc.)
- Node-only modules (`node:fs`, `pg`, etc.)
- `tools/architecture`

**packages/features/\*** may import:

- `packages/ui`
- `packages/contracts/*`
- `packages/domain/*` (where boundary rules allow)
- TanStack Query hooks
- TanStack Router route helpers

**packages/features/\*** must NOT import:

- `packages/adapters-*`
- Postgres/Redis/ClickHouse clients
- Server runtime packages

**packages/ui** may import:

- React, React Aria Components
- Tailwind/class utilities (tailwind-merge, clsx, cva)
- lucide-react
- `@tanstack/react-table` (DataTable shell only)
- sonner

**packages/ui** must NOT import:

- `packages/features/*`
- `packages/domain/*`
- `packages/contracts/*` (except narrow type-only imports approved by ADR)
- `packages/adapters-*`
- App packages

**packages/domain/\*** must NOT import:

- React or any React library
- `packages/ui`
- `packages/adapters-*`
- Router, query, or form libraries

**packages/contracts/\*** must NOT import:

- React UI libraries
- `packages/adapters-*`
- App packages

## Rationale

Option C (TanStack ecosystem + React Aria + open-code UI) is chosen because:

1. **Type safety** — TanStack Router provides the strongest route param typing available in the React SPA ecosystem. Combined with TanStack Query's typed queries and Zod schemas, the full request/response cycle is typed without ceremony.

2. **Accessibility** — React Aria implements WAI-ARIA patterns correctly for complex components. Rolling focus management and keyboard behaviour by hand is error-prone and under-tested. React Aria separates behaviour from style, allowing full visual control.

3. **Component ownership** — Adopting Material UI or Ant Design as the baseline transfers visual identity ownership to a third party. An open-code model keeps component APIs and visual decisions in the repository.

4. **State isolation** — TanStack Query for server state and Zustand for UI state avoids the common pattern of mixing server data into a Redux store. Domain data stays in the query cache; UI preferences stay local.

5. **Minimal footprint** — React Hook Form + Zod is the lightest complete form/validation stack that integrates cleanly with the contract schema model (DTO schemas defined in `packages/contracts`).

## Consequences

**Positive:**

- Type-safe routing eliminates a class of runtime navigation errors.
- Accessible components are the default path; accessibility debt does not accumulate.
- Contract schemas and form schemas share the same Zod language; validation is DRY.
- Open-code UI components give the platform full control over design tokens, variants, and APIs.
- MSW allows realistic API mocking in tests and optionally in the browser during development.

**Negative:**

- More upfront work to establish UI primitives than adopting a full component suite.
- TanStack Router v1 is relatively new; may have API changes.
- Open-code components require ongoing maintenance as React Aria and Tailwind evolve.

**Neutral / operational:**

- The DataTable shell delegates column/row decisions to feature packages — features are responsible for defining their data representations.
- AG Grid is not adopted initially. Adoption criteria: Excel-like cell editing, column pivoting, multi-level grouping, server-side row model for >100K rows, or enterprise licensing acceptance. Requires dedicated ADR.
- Next.js and TanStack Start are architecturally incompatible with the current platform model (ADR-0003 Vite SPA + BFF). Adoption requires superseding ADR-0003 and ADR-0013; they are not a deferral candidate.
- XState is not adopted initially. For complex UI state machines (multi-step wizards, multi-stage form flows, complex approval workflows), XState is the preferred choice over ad-hoc Zustand reducers. Introduce per-feature without requiring a formal ADR once the test harness (ADR-ACT-0097) is in place.
- Storybook is not adopted initially. Recommended for `packages/ui` component documentation and visual regression once the primitive set (ADR-ACT-0095) is established.
- Playwright is not adopted initially. E2E testing is out of scope for ADR-ACT-0097 (frontend unit/component/integration). Introduce after the first vertical slice proves the MSW-mocked integration pattern.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting and library selection analysis
- Human review status: Reviewed by architecture owner
- Evidence checked: `docs/evidence/frontend/react-component-platform-baseline.md`
- Validation required: All quality gates pass before ADR-ACT-0008 begins

## Validation / evidence

Evidence level: High

Evidence file: `docs/evidence/frontend/react-component-platform-baseline.md`

All quality and architecture gates pass at commit of this ADR.

## Impacted areas

- Architecture: Package boundary rules extended for frontend packages.
- API: Contract schemas now formally serve as shared Zod schemas for BFF validation and client forms.
- Testing: Frontend test harness (ADR-ACT-0097) is a gating follow-up before first slice.
- Delivery: Vite SPA and BFF deployment model confirmed.
- UX: Accessible components are the default delivery vehicle.
- Documentation: `docs/evidence/frontend/` category added.

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-28

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0001: Hexagonal architecture
- ADR-0002: Bounded contexts — experience domain
- ADR-0003: Modular monorepo
- ADR-0013: Client-facing API boundary
- ADR-0016: Quality gate baseline
- `docs/evidence/frontend/react-component-platform-baseline.md`
- TanStack Router: <https://tanstack.com/router>
- TanStack Query: <https://tanstack.com/query>
- TanStack Table: <https://tanstack.com/table>
- React Aria Components: <https://react-spectrum.adobe.com/react-aria/components.html>
- React Hook Form: <https://react-hook-form.com>
- Zod: <https://zod.dev>
- Zustand: <https://zustand-demo.pmnd.rs>
- Tailwind CSS: <https://tailwindcss.com>
- class-variance-authority: <https://cva.style>
- Vitest: <https://vitest.dev>
- MSW: <https://mswjs.io>
- Sonner: <https://sonner.emilkowal.ski>
- cmdk: <https://cmdk.paco.me>
- Recharts: <https://recharts.org>
- date-fns: <https://date-fns.org>

## Notes

ADR-0018 is reserved for a separate architectural decision. ADR-0019 is the frontend platform baseline.

The `shadcn/ui` project is referenced as a component pattern source (open-code model, React Aria integration examples) but is not imported as a package dependency. Components are authored directly in `packages/ui`.

AG Grid is not adopted initially. Specific criteria that justify introducing it (each requires a dedicated ADR):

- Excel-like cell editing with formula support
- Column pivoting and grouping at enterprise scale
- Server-side row model for >100K rows with deferred loading
- Enterprise licensing acceptance by the organisation

TanStack Table covers the initial use case (server-side pagination/sorting/filtering via search params, headless rendering). AG Grid is the upgrade path if TanStack Table reaches its limits.

The full `packages/ui` primitive set (Button through DataTable) must be stubbed or implemented before ADR-ACT-0008 begins. See ADR-ACT-0095.
