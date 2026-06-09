# Canonical UI feature template

Reference scaffolding for a new SPA feature (ADR-0019, ADR-ACT-0203). Copy this
folder to `src/features/<name>/` (or run `npm run generate:feature`) and replace
`Widget`/`widget` with your feature name. This folder is **reference only** — it
is excluded from `tsc`, ESLint, Prettier, and the test runner because it imports
generated GraphQL documents that only exist once you author real operations.

The authoritative, narrated guide is **`docs/patterns/ui-feature-template.md`**.

## Layering (do not break)

```
route (src/routes/**)         → permission gate + page, under the _authenticated layout
  └─ FeaturePage.tsx          → dumb: composes hooks + design-system primitives only
       ├─ feature.queries.ts  → TanStack Query read hooks  ─┐ the ONLY layer that
       └─ feature.mutations.ts→ TanStack Query write hooks ─┘ touches the GraphQL client
            └─ @platform/graphql-browser-client + generated TypedDocumentNode
                 (operations authored in packages/contracts-graphql/src/operations/*.graphql)
```

Rules enforced by architecture validators (`npm run test:architecture`):

- Feature pages/components **must not** render `<main id="main-content">` — the
  `_authenticated` AppShell owns the single main landmark.
- Feature code **must not** contain inline GraphQL operation strings or call
  `fetch('/api/graphql')` — author operations as `.graphql` documents and run
  `npm run codegen`; call them through the browser client.
- Components stay dumb: no GraphQL, no fetch, no data-source knowledge.

## Files

| File | Responsibility |
|------|----------------|
| `feature.schema.ts` | Zod schema(s) for forms/inputs (validation mirrors the contract). |
| `feature.queries.ts` | Read hooks: `graphqlRequest(SomeQueryDocument)`. |
| `feature.mutations.ts` | Write hooks: `graphqlRequest(SomeMutationDocument, vars)` + invalidate-on-success. |
| `FeaturePage.tsx` | Dumb page: loading / empty / error / forbidden states, form, table. |
| `components/` | Presentational subcomponents (no data fetching). |
| `__tests__/` | MSW-backed tests using personas + GraphQL factories from `src/msw`. |

## Checklist for a new feature

1. Author operations in `packages/contracts-graphql/src/operations/<name>.graphql`, run `npm run codegen`.
2. Add i18n keys under `feature.<name>.*` in `packages/i18n-runtime/locales/en-GB.json`.
3. Add a route in `src/routes/**` under the `_authenticated` layout, wrapped in `<RequirePermission>`.
4. Add MSW resolvers for the new operations (extend `src/msw/graphql/factories.ts`) and a fixture.
5. Write feature hooks + a dumb page using design-system primitives and token classes.
6. Cover success / empty / error / forbidden + permission variants in `__tests__` with MSW.
7. `make check` + `npm run test:frontend:run` must pass.
