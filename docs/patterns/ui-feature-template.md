# UI feature development pattern (canonical)

> Status: canonical baseline (ADR-ACT-0203). Source of truth for building new SPA
> screens. Reference scaffolding lives in
> `apps/react-enterprise-app/src/features/_template/`; the live reference
> implementation is the **organisation profile** feature
> (`src/features/organisation/`). Scaffold a new feature with
> `npm run generate:feature -- --name=<name> --type=<type>`.

This pattern exists so every new screen conforms automatically to repository ADRs,
architecture boundaries, accessibility, theming, the GraphQL contract flow,
testing, and MSW — without re-inventing structure.

## 1. Layering (the one rule that matters)

```text
src/routes/**                     route + permission gate, under the _authenticated layout
  └─ <Feature>Page.tsx            dumb page: design-system primitives + feature hooks only
       ├─ <feature>.queries.ts    TanStack Query READ hooks  ─┐ ONLY layer allowed to call
       └─ <feature>.mutations.ts  TanStack Query WRITE hooks ─┘ the GraphQL client
            └─ @platform/graphql-browser-client  (graphqlRequest)
                 + generated TypedDocumentNode from @platform/contracts-graphql
                      ← packages/contracts-graphql/src/operations/<feature>.graphql
```

- **Components are dumb.** They receive data via props/hooks and render it. No
  `fetch`, no GraphQL, no `print`, no inline operation strings.
- **Hooks own data.** Feature hooks import generated documents + `graphqlRequest`.
- **The client is the only stringifier.** `@platform/graphql-browser-client`
  prints a `TypedDocumentNode` via `graphql/language/printer` and POSTs to
  `/api/graphql`. Nothing else in the SPA imports `graphql/*`.

## 2. GraphQL operations (generated, never inline)

1. Author operations as documents:
   `packages/contracts-graphql/src/operations/<feature>.graphql`.
2. Run `npm run codegen` → emits browser-safe `TypedDocumentNode` constants +
   result/variable types into `packages/contracts-graphql/src/generated/graphql.ts`.
3. `npm run codegen:check` (wired into `make check`) fails CI if the committed
   artifact drifts from the schema/operations.

```graphql
query WidgetList {
  widgets {
    id
    name
  }
}
mutation CreateWidget($name: String!) {
  createWidget(name: $name) {
    id
    name
  }
}
```

The schema itself is single-sourced from `BASE_SCHEMA_SDL` in
`@platform/contracts-graphql` (ADR-0013, ADR-0028). Schema changes go through that
package + an ADR for breaking changes.

## 3. Query & mutation hooks

```ts
// <feature>.queries.ts
export const widgetListQueryKey = ["widget", "list"] as const;
export function useWidgetList() {
  return useQuery({
    queryKey: widgetListQueryKey,
    queryFn: async () => (await graphqlRequest(WidgetListDocument)).widgets,
    staleTime: 30_000,
    retry: false,
  });
}

// <feature>.mutations.ts — invalidate-on-success is the default; add
// onMutate/onError rollback here for optimistic UI.
export function useCreateWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WidgetFormValues) =>
      graphqlRequest(CreateWidgetDocument, { name: input.name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: widgetListQueryKey }),
  });
}
```

## 4. Route + permission gate

Protected routes are children of the `_authenticated` pathless layout
(`src/routes/_authenticated.tsx`), which owns authentication and the single
`<main id="main-content">` via `AppShell`. Per-route permission uses
`RequirePermission`:

```tsx
export const Route = createRoute({
  getParentRoute: () => AuthenticatedRoute,
  path: "/widgets",
  component: () => (
    <RequirePermission permission="widget.read">
      <WidgetPage />
    </RequirePermission>
  ),
});
```

Public/unauthenticated routes (`/`, `/login`) stay direct children of the root.

## 5. Page composition (states + primitives)

The page handles every async state and uses design-system primitives only:

| State                     | Primitive                                                  |
| ------------------------- | ---------------------------------------------------------- |
| loading                   | `LoadingState`                                             |
| empty                     | `EmptyState`                                               |
| error (transport/GraphQL) | `ErrorState` / `Alert variant="destructive"`               |
| forbidden                 | handled at route by `RequirePermission` (`ForbiddenState`) |
| form                      | `FormField` + `Controller` (react-hook-form) + `Button`    |
| async feedback            | `LiveRegion` (polite = status, assertive = errors)         |
| list/table                | `DataTable`                                                |

All colour comes from semantic tokens (`bg-primary`, `text-fg`, `border-border`,
`text-danger`, …) defined in `src/styles/globals.css` — never raw palette classes.
Branding flows through `--color-primary`, which the tenant theme client overrides.

## 6. i18n

All user-visible text uses `useTranslation()` with keys under `feature.<name>.*`
(ADR-0026). Add keys to `packages/i18n-runtime/locales/en-GB.json`. The
`validate-i18n` architecture check fails the build on a missing key.

## 7. Accessibility

- No second `<main>` — the shell owns it (validator-enforced).
- Inputs labelled (`FormField` associates `Label`/`FieldError`); errors announced
  via `role="alert"` live regions; success via `role="status"`.
- Focus-visible rings + forced-colors support come from the global baseline.
- Cover with `vitest-axe` in the feature test.

## 8. MSW & tests

Tests are MSW-backed — no hand-rolled fetch mocks. Use personas + GraphQL
factories from `src/msw`:

```ts
server.use(
  sessionHandler("tenantAdmin"),
  createGraphqlHandler({ WidgetList: () => ({ data: { widgets: [] } }) })
);
```

Add a fixture in `src/msw/fixtures/` and resolvers in
`src/msw/graphql/factories.ts` keyed by **generated operation name**. Cover
success / empty / error / permission variants + an axe pass.

## 9. Gates

```bash
npm run codegen:check        # generated artifact in sync
npm run tsc:check
npm run test:frontend:run
npm run test:architecture    # boundaries, no-inline-graphql, no-feature-main, i18n
make check
```
