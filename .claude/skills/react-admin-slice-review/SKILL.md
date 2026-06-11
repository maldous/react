---
name: react-admin-slice-review
description: Review admin UI changes for TanStack Router/Query usage, RHF+Zod forms, design-system components, accessibility, permission gating, typed error semantics, contextual audit refresh after mutations, and MSW coverage. Use when /admin React UI changes.
---

# React admin slice review

Review `/admin` control-plane UI changes against the frontend stack and conventions (ADR-0019, ADR-0036).
Report only; make no broad product changes.

## Trigger conditions

- Changes under the React app's `/admin` (or `/auth`) routes, components, hooks, or forms.
- New admin route, table, form, or mutation flow.

## Files / dirs to inspect

- `apps/react-enterprise-app/**` admin routes/components/hooks (`_authenticated` layout).
- Feature-owned TanStack Query hooks + generated GraphQL types (`packages/contracts-graphql/src/generated`).
- MSW handlers/fixtures for the touched routes.
- `tools/architecture/validate-frontend-conventions/` for the enforced rules.
- ADR-0019 (frontend stack), ADR-0026 (i18n for public text), ADR-0036 (admin control plane).

## Checks

1. **Routing** — TanStack Router file-route under `_authenticated`; loader/search params typed.
2. **Data** — TanStack Query for reads/mutations; no direct fetch bypassing the BFF (constraint #1).
3. **Forms** — React Hook Form + Zod schema; server errors surfaced via typed `platform-errors` envelope, not raw strings.
4. **Design system** — uses shared design-system components + theme tokens; no ad-hoc styling.
5. **Accessibility** — labels, roles, keyboard focus, error association; tables/dialogs accessible.
6. **Permission gating** — UI gated by server-provided permission/readiness; the SPA decides no tenant authority.
7. **Audit refresh** — after a mutation, contextual audit trail / readiness is refetched/invalidated.
8. **i18n** — public-facing text routed through the i18n layer (check ACTION-REGISTER status before treating as a hard gate).
9. **MSW coverage** — handlers exist for new/changed routes so tests run offline.

## Commands to run / recommend

```bash
npm run frontend:conventions
npm run test:frontend:run        # targeted; do not run the full sweep on every edit
```

## Report template

```text
React admin slice review: PASS | ISSUES

Scope: <files/routes>
Router/Query: <ok / issues>
RHF+Zod + error semantics: <ok / issues>
Design system + a11y: <ok / issues>
Permission gating (server authority): <ok / issues>
Audit refresh after mutation: <present / missing>
MSW coverage: <complete / gaps>
frontend:conventions: <PASS/FAIL>
Targeted tests: <result or not run>
```
