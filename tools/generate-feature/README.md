# generate-feature

Zero-dependency Node scaffolder for new SPA features (ADR-ACT-0203). Emits a
canonical, **compiling and test-passing** feature skeleton that conforms to
`docs/patterns/ui-feature-template.md` — dumb page using design-system primitives +
token classes, feature-owned hooks, an MSW-backed test, a route under the
`_authenticated` layout with a `RequirePermission` gate, and i18n placeholders.

## Usage

```bash
npm run generate:feature -- --name=<kebab-or-camel> --type=<type> [--permission=<perm>] [--dry-run]
```

- `--name` feature name (e.g. `billing`, `audit-log`). Casing is derived.
- `--type` one of the templates below.
- `--permission` route permission (default `<feature>.read`).
- `--dry-run` print the plan without writing.

## When to use each type

| `--type`           | Use for                                                   | Emits                                                     |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `form-edit`        | A single editable record (settings-of-one, profile-like). | query + mutation + schema + form page + test + route      |
| `read-only-detail` | A read-only detail/summary screen.                        | query + detail page + test + route                        |
| `table-search`     | A searchable list/table.                                  | query + table page with client-side filter + test + route |
| `admin-settings`   | A settings form with validation (admin surface).          | query + mutation + schema + form page + test + route      |

## After generating

Data hooks are stubbed so the feature builds immediately. To wire real data:

1. Register the route in `apps/react-enterprise-app/src/routeTree.gen.ts` under the
   `_authenticated` layout's `addChildren([...])`.
2. Author `packages/contracts-graphql/src/operations/<name>.graphql`, run `npm run codegen`.
3. Replace the stub `queryFn`/`mutationFn` with `graphqlRequest(<GeneratedDocument>)`
   (import from `@platform/graphql-browser-client` + `@platform/contracts-graphql`).
4. Add MSW resolvers in `src/msw/graphql/factories.ts` keyed by the generated
   operation name, then flesh out the test.
5. `npm run tsc:check && npm run test:frontend:run && make check`.

The generator intentionally emits no inline GraphQL strings and no second
`<main>`, so output passes the architecture validators out of the box.
