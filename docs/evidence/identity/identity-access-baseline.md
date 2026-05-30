# Identity and access control baseline evidence

## Summary

Ratified identity, tenancy, roles, permissions model, and SSO boundary before the first vertical slice (ADR-ACT-0008). Governed by ADR-0021 and ADR-0022.

## Governance

- ADR-0021 (identity, tenancy, roles, permissions ? accepted)
- ADR-0022 (authentication, session, SSO boundary ? accepted)
- ADR-ACT-0105 (Open ? identity/access-control contracts and domain primitives)
- ADR-ACT-0106 (Open ? platform-auth/session boundary primitives)
- ADR-ACT-0107 (Open ? protected route and API guard primitives)
- ADR-ACT-0108 (Open ? Keycloak adapter skeleton)
- ADR-ACT-0008 (Open ? updated: authenticated organisation profile slice)
- Committed: 2026-05-28

## Identity model

### Entities

| Entity | Purpose |
| --- | --- |
| `User` | Internal platform identity ? stable UUID, independent of any IdP |
| `ExternalIdentity` | Maps SSO provider subject to internal User (provider + providerSubject) |
| `Organisation` | Multi-tenant boundary ? tenantId/organisationId |
| `Membership` | User relationship to an Organisation with a tenant-scoped Role |
| `Role` | Named bundle of Permissions (global or tenant-scoped) |
| `Permission` | Atomic authorisation string code ? the enforcement primitive |
| `SessionActor` | Runtime-safe projection of authenticated actor context for RuntimeContext |

### Key rules

- A User is not the same as an external login ? `ExternalIdentity` bridges the two.
- A User gains access through `Membership`. Roles are assigned through Membership.
- One User can belong to multiple Organisations (multiple Memberships).
- `SessionActor` is a plain value object ? never mutated, never holds tokens.

## Role model

### Global roles

| Role | Scope | Notes |
| --- | --- | --- |
| `system-admin` | Global (cross-tenant) | Not assignable via product UI |

### Tenant-scoped roles

| Role | Scope | Semantics |
| --- | --- | --- |
| `tenant-admin` | Per Membership | Full org control |
| `manager` | Per Membership | Manage members; no org settings |
| `member` | Per Membership | Standard product access |
| `viewer` | Per Membership | Read-only access |

## Permission model

### Baseline permissions

| Permission | Granted to |
| --- | --- |
| `organisation.read` | viewer+ |
| `organisation.update` | tenant-admin+ |
| `member.read` | viewer+ |
| `member.invite` | manager+ |
| `member.update_role` | tenant-admin+ |
| `profile.read_self` | all authenticated |
| `profile.update_self` | all authenticated |
| `admin.access` | tenant-admin+ |
| `audit.read` | tenant-admin+ |

### Enforcement rules

- **Permissions are the authoritative enforcement primitive.** Role checks are convenience shorthands.
- UI checks hide/show controls (convenience only ? not enforcement).
- API guards enforce permissions before calling use cases.
- Use cases enforce business permissions before executing domain operations.
- Domain layer does not trust any frontend check.
- `tenantId` always comes from the verified session ? never from client-supplied parameters.

## SSO boundary

### What Keycloak is

Keycloak is an **adapter**, not the domain model. `packages/adapters-keycloak` is the only package that imports Keycloak-specific types or SDK. External Keycloak claims (JWT `sub`, `preferred_username`, `realm_access`) are mapped to internal `User + ExternalIdentity` at the adapter boundary.

### What Keycloak is not

- Keycloak types do not appear in domain packages or React feature packages.
- Keycloak JWTs do not appear in RuntimeContext or SessionActor.
- Replacing Keycloak is localised to `packages/adapters-keycloak`.

## Session model

### Server side (BFF)

| Field | Description |
| --- | --- |
| Session ID | Cryptographically random opaque token (in HTTP-only cookie) |
| Storage | Redis via `packages/adapters-redis` |
| Content | userId, tenantId, permissions[], displayName, token expiry, encrypted refresh token |
| Cookie | HttpOnly; Secure; SameSite=Strict; Path=/ |

### Browser side (React app)

- Holds `SessionActor` value from `/api/session` in TanStack Query cache.
- Does not hold, persist, or decode tokens.
- On 401: TanStack Query retry ? redirect to `/auth/login`.
- No raw tokens in Zustand or localStorage.

### RuntimeContext derivation (per-request)

```text
Session cookie ? Redis lookup ? SessionActor ?
  RuntimeContext { requestId, traceId, actorId, tenantId, permissions }
```

RuntimeContext is derived fresh on every authenticated request and never mutated.

## Package boundary

| Package | Type | State |
| --- | --- | --- |
| `packages/contracts-auth` | Contract (Zod, zero @platform deps) | Planned ? ADR-ACT-0105 |
| `packages/domain-identity` | Domain (no HTTP, no adapters) | Planned ? ADR-ACT-0105 |
| `packages/access-control` | Interface (existing, zero @platform deps) | Exists |
| `packages/session-runtime` | Platform interface (existing) | Exists |
| `packages/adapters-keycloak` | Adapter (existing) | Exists (skeleton) |
| `packages/adapters-redis` | Adapter (existing) | Exists |
| `packages/platform-runtime-context` | Platform (existing) | Implemented |

## First slice implications (ADR-ACT-0008)

The first vertical slice proves:

```text
React protected route (organisation.read permission check)
? useSession() ? SessionActor from TanStack Query
? useOrganisationProfile() ? TanStack Query feature hook
? contract client ? BFF/API route
? API guard (organisation.read permission enforcement)
? use case (getOrganisationProfile)
? domain logic (Organisation entity validation)
? Postgres adapter (read from adapters-postgres)
? local Postgres (localhost:5433 via Compose)
? structured logs with requestId/traceId/actorId/tenantId
? UI renders read-only (viewer) or editable (tenant-admin) state
```

Test cases required:

1. **Permitted**: `tenant-admin` can load and edit organisation profile ? 200 OK
2. **Permitted read-only**: `viewer` can load but not edit ? 200 OK, edit controls hidden
3. **Forbidden**: authenticated user without Membership in this org ? 403 ForbiddenError
4. **Unauthenticated**: no session cookie ? 401 UnauthorizedError (and redirect in React)

## Rejected alternatives

| Alternative | Reason rejected |
| --- | --- |
| Token-based SPA (access token in memory/localStorage) | XSS-accessible; complex refresh logic in browser; token leakage risk |
| Keycloak JS adapter in browser | Keycloak types leak into React packages; IdP-specific coupling |
| ABAC (OPA/Casbin) as baseline | Over-engineered before first slice; addressable via permission resolution enrichment later |
| Role-only enforcement (no permissions) | Role addition is expensive; can't add partial access without new roles |
| Login as first vertical slice | Overloads ADR-ACT-0008; hides architecture decisions inside SSO complexity |

## Commands run

```text
make check                           ? all quality gates pass
npm run test:coverage                ? 271/271 architecture tests pass
npm run test:frontend:run            ? 10/10 frontend tests pass
node orchestrator all --strict       ? 6/6 architecture tools passed
npm run audit:deps                   ? 0 vulnerabilities
npm run audit:osv                    ? 0 issues
```

## ADR-ACT-0008 status

**ADR-ACT-0008 (first vertical slice) has NOT started.** This evidence establishes the identity/access baseline required before implementation begins.
