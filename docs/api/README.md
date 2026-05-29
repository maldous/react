# API contract surface

The REST API is a supplementary boundary (ADR-0013). GraphQL (`@platform/contracts-graphql`) is the primary client boundary.

These routes are documented as OpenAPI 3.1 in `docs/api/openapi.json`.

## Routes

| Route                     | Method | Purpose                  |
| ------------------------- | ------ | ------------------------ |
| /healthz                  | GET    | Process liveness         |
| /readyz                   | GET    | Dependency readiness     |
| /version                  | GET    | Build metadata           |
| /api/session              | GET    | Current session actor    |
| /auth/login               | GET    | Begin OAuth login (PKCE) |
| /auth/callback            | GET    | OAuth callback           |
| /auth/logout              | POST   | Destroy session          |
| /api/organisation/profile | GET    | Organisation profile     |
| /api/organisation/profile | PATCH  | Update display name      |

## Viewing the spec locally

```bash
# Using Redoc (no install required):
npx @redocly/cli preview-docs docs/api/openapi.json

# Using Swagger UI:
npx swagger-ui-watcher docs/api/openapi.json
```

## Maintenance

`docs/api/openapi.json` is maintained manually alongside route changes.
When adding a new route to `apps/platform-api/src/server/routes.ts`, update this file in the same commit.

## Not in scope

GraphQL schema contracts are owned by `@platform/contracts-graphql`.
This spec covers only the supplementary REST routes.
