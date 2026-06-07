# Apps Codemap

**Last Updated:** 2026-06-07

Two applications: Node.js BFF (platform-api) and React 19 SPA (react-enterprise-app).

## platform-api

**Type**: Application (Node.js BFF)  
**Port**: 3001  
**Lifecycle**: experimental  
**Bounded Context**: api-server

### Responsibilities

- Database migrations & schema (identity tables)
- Fixture seed & reset (local/test)
- Health/readiness/version endpoints
- Session management (fixture provider for pre-Keycloak testing)
- Server-side observability usage
- Forward auth for Caddy tool routes

### Key Dependencies (17 @platform/\*)

- Runtimes: api-runtime, session-runtime, authorisation-runtime
- Observability: platform-logging, platform-observability, platform-runtime-context, adapters-sentry
- Data: adapters-postgres, adapters-redis, adapters-keycloak, adapters-object-storage
- Contracts: contracts-auth, contracts-organisation
- Domain: domain-identity
- Other: audit-events, i18n-runtime, platform-errors

### Entry Points

- `src/index.ts` — main app factory
- `src/db/` — migrations, seed fixtures
- `src/routes/` — health, readiness, version, session, auth handlers

### Test Coverage

- 25 test files (\*.test.ts)
- Tests in `src/**/*.test.ts` — unit + integration

### ADR References

ADR-0001, ADR-0002, ADR-0003, ADR-0005, ADR-0017, ADR-0020, ADR-0021, ADR-0022, ADR-0023

---

## react-enterprise-app

**Type**: Application (React 19 SPA, Vite)  
**Port**: 5173 (dev), served via Caddy at `http://localhost:80` or per-tenant alias  
**Lifecycle**: experimental  
**Bounded Context**: app-shell

### Responsibilities

- React 19 component tree, hooks, state management
- GraphQL client (generated contracts, Apollo)
- Tailwind CSS styling
- Multi-tenant routing & per-tenant UI
- Form validation (client-side)
- Session/auth integration (BFF-mediated only)

### Key Dependencies (allowed @platform/\*)

- UI: ui-design-system (only presentation layer)
- Contracts: contracts-graphql, contracts-organisation (DTO schemas)
- Errors: platform-errors (typed error checks, no server packages)

### Browser-Safe Constraint

**Forbidden**: api-runtime, platform-logging, platform-observability, platform-runtime-context, adapters-\*, platform-api, pg, pino

Entry points must not import Node-only packages or server runtime code. All server calls route through BFF (`/api/*` or GraphQL endpoint).

### Entry Points

- `src/index.ts` — app root
- `src/main.tsx` — React mount point (Vite)
- `src/routes/` — route definitions
- `src/components/` — React components

### Test Coverage

- 4 test files (\*.test.tsx)
- E2E tests in `e2e/` directory (Playwright, ADR-0025)

### ADR References

ADR-0001, ADR-0002, ADR-0003, ADR-0019, ADR-0022, ADR-0028

---

## Total: 29 test files

- platform-api: 25
- react-enterprise-app: 4
- Integration & E2E: in `e2e/` (Playwright, separate suite)
