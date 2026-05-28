# ADR-0022: Define authentication, session, and SSO integration boundary

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture — adapters own external integrations)
- ADR-0002 (bounded contexts — security domain)
- ADR-0013 (client-facing API boundary — BFF owns session exchange)
- ADR-0017 (Compose substrate — Keycloak in identity profile)
- ADR-0019 (React component platform — browser security model)
- ADR-0020 (RuntimeContext — actorId, tenantId, safe session context)
- ADR-0021 (identity model — User, ExternalIdentity, SessionActor)

## Context

Without a defined authentication and session boundary, each feature will independently decide how to handle login, token storage, session expiry, and API authentication. These choices accumulate into inconsistent security posture that is expensive to retrofit.

This ADR fixes the boundary between the SSO provider (Keycloak), the BFF/API session layer, and the React application. It intentionally avoids specifying full Keycloak configuration — that is an adapter concern.

## Stakeholder concerns

- **Security:** Raw tokens must not persist in browser-accessible storage. Session cookies must be HTTP-only. API guards must enforce permissions derived from the session, not from client-supplied claims.
- **Engineering:** Keycloak-specific types must not leak into domain packages or React feature packages. Replacing Keycloak later must be a localised adapter change.
- **Product:** The login flow is not the first vertical slice. The first slice proves the authenticated session → domain → database stack. Login mechanics can remain skeletal.
- **Architecture:** `packages/adapters-keycloak` owns all Keycloak SDK usage. The domain and React packages use only the internal types from `packages/contracts-auth` and `platform-runtime-context`.

## Decision drivers

1. The SSO provider is an implementation detail — domain and React feature packages must never import Keycloak types directly.
2. The browser must not hold raw access tokens in JavaScript-accessible storage.
3. The BFF owns session creation and token exchange. The React app works with session state, not tokens.
4. Protected routes in React are a UX convenience. API guards are the enforcement point.
5. RuntimeContext (ADR-0020) carries safe actor context derived from the verified session — never raw token claims.

## Options considered

### Option A: Token-based SPA (access token in memory / localStorage)

React app holds the access token. API routes verify it on every request.

Pros: Stateless API; no server-side session.

Cons:

- Access token in memory is XSS-accessible.
- Token in localStorage persists across browser sessions uncontrolled.
- BFF adds no value; API must verify tokens directly.
- Refreshing tokens requires complex silent iframe or redirect logic in the browser.

### Option B: BFF with HTTP-only session cookie (chosen)

BFF handles the OAuth callback, exchanges code for tokens, creates a server-side session, and sets an HTTP-only cookie. React app interacts only with the BFF. API receives session cookie and derives actor context.

Pros:

- Access token never reaches browser JavaScript.
- Refresh is invisible to the React app.
- Cookie is HTTP-only, not accessible to XSS.
- BFF is the single integration point for Keycloak changes.

Cons:

- BFF session store is a dependency (Redis via `packages/adapters-redis`).
- Cookie-based auth has CSRF considerations — handled via SameSite cookie policy and CSRF token where needed.

### Option C: Keycloak JS adapter in browser

Keycloak-specific JS SDK in the React app.

Cons:

- Keycloak SDK types leak into React packages.
- Replacing Keycloak requires changes across the React codebase.
- Token handling complexity moves into the browser.

## Decision

---

### 1. SSO provider model

Keycloak (or any future IdP) is an adapter, not part of the domain or frontend model.

Rules:

- `packages/adapters-keycloak` owns all Keycloak SDK imports and Keycloak-specific types.
- No other package imports from `keycloak-js`, `@keycloak/keycloak-admin-client`, or any Keycloak-specific library.
- Keycloak's JWT claims (`sub`, `preferred_username`, `realm_access`, etc.) are mapped to internal types at the adapter boundary.
- The BFF adapter reads the Keycloak token and writes an internal `SessionActor` (ADR-0021) into the session.
- Domain packages receive `RuntimeContext` with `actorId`, `tenantId`, and `permissions` — never Keycloak claim objects.

---

### 2. Login flow (OAuth 2.0 Authorization Code with PKCE)

```text
1. React app → GET /auth/login → BFF redirects to Keycloak
2. Keycloak authenticates user → redirects to BFF callback
3. BFF callback: exchanges code for tokens (via adapters-keycloak)
4. BFF: looks up or creates internal User + ExternalIdentity (via domain-identity)
5. BFF: resolves active Membership + Role + Permissions (via access-control)
6. BFF: creates server-side session → stores SessionActor in Redis
7. BFF: sets HTTP-only session cookie → redirects React app to /
8. React app: requests session state from BFF (/api/session) → receives safe SessionActor JSON
```

The React app never receives an access token. It receives only the safe `SessionActor` shape from the BFF session API.

---

### 3. Session model

**Server side (BFF):**

- Session is stored in Redis (`packages/adapters-redis`) with a configurable TTL.
- Session record contains: `userId`, `tenantId`, resolved `permissions[]`, `displayName`, token expiry, and Keycloak refresh token (encrypted, not exposed to browser).
- Session ID is a cryptographically random opaque token.
- Session cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`.

**Browser side (React app):**

- Holds the `SessionActor` value fetched from `/api/session` in TanStack Query cache.
- Does not hold, persist, or decode tokens.
- On session expiry: silent refresh via BFF → React app re-fetches session state.
- On auth error (401): React Router redirects to `/auth/login`.

**RuntimeContext (per-request):**

The BFF derives `RuntimeContext` on every authenticated request:

```typescript
// Resolved from session store on every API request
const runtimeContext: RuntimeContext = {
  requestId: generateRequestId(),
  traceId: extractTraceId(req),
  actorId: session.userId,
  tenantId: session.tenantId,
  organisationId: session.tenantId,
  permissions: session.permissions, // pre-resolved at login
};
```

RuntimeContext is never mutated after derivation. Permissions are resolved at login time and stored in the session; they are refreshed when the session is refreshed.

---

### 4. Package boundary

| Package                             | Responsibility                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/contracts-auth`           | Safe auth contracts: `SessionActor`, login/logout request/response shapes, `AuthError` subtypes |
| `packages/domain-identity`          | User, Organisation, Membership, ExternalIdentity domain models and rules (ADR-0021)             |
| `packages/access-control`           | Permission check interface — resolves permissions from roles (existing, zero `@platform` deps)  |
| `packages/session-runtime`          | BFF session management: create/read/refresh/destroy session records (existing)                  |
| `packages/adapters-keycloak`        | Keycloak token exchange, claim mapping → ExternalIdentity (existing)                            |
| `packages/adapters-redis`           | Session storage backend (existing)                                                              |
| `packages/platform-runtime-context` | Carries `SessionActor` fields at request scope (ADR-0020)                                       |

**Forbidden imports:**

- React app and feature packages must not import `packages/adapters-keycloak`.
- Domain packages must not import session, Keycloak, or HTTP types.
- `packages/contracts-auth` must not import adapters or domain packages (contract package — Zod schemas only).

---

### 5. Protected routing in React

**React Router protected routes are a UX convenience — not a security enforcement mechanism.**

Rules:

- A protected route checks session state (from TanStack Query `useSession()` hook) before rendering.
- If no session: redirect to `/auth/login` with `returnTo` parameter.
- If session exists but missing permission: render a safe `ForbiddenState` component.
- The actual permission enforcement happens at the API layer — if the React check is bypassed, the API guard will reject the request.

```typescript
// Correct pattern: check for permission in React (UX convenience)
function ProtectedRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const { actor, isLoading } = useSession();
  if (isLoading) return <LoadingState />;
  if (!actor) return <Navigate to="/auth/login" />;
  if (!actor.permissions.includes(permission)) return <ForbiddenState />;
  return children;
}
```

---

### 6. API guard pattern

Every BFF/API route that accesses protected resources must:

1. Verify session cookie → load session from Redis.
2. Derive `RuntimeContext` including `actorId`, `tenantId`, `permissions`.
3. Check the required permission before calling the use case.
4. Return `UnauthorizedError` (401) if no valid session.
5. Return `ForbiddenError` (403) if session exists but permission is missing.
6. Never derive `tenantId` from request body or query parameters — always from session.

```typescript
// Correct pattern: API guard checks permission before use case
async function handler(req, res) {
  const ctx = await deriveRuntimeContext(req); // throws UnauthorizedError if no session
  assertPermission(ctx, "organisation.read"); // throws ForbiddenError if missing
  const result = await getOrganisationProfile(ctx); // use case
  res.json(result);
}
```

---

### 7. Logout

- React app calls `POST /auth/logout`.
- BFF destroys server-side session, clears Redis entry, clears session cookie.
- React Router redirects to `/auth/login`.
- Keycloak session may be invalidated via back-channel logout (adapter concern).

---

### 8. Local development (Compose identity profile)

The `identity` Compose profile provides a local Keycloak instance at `localhost:8080`. During development:

- Developers configure a Keycloak realm with the platform client and test users.
- `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` are set in `.env`.
- The local Keycloak is not equivalent to production IdP — it is a development convenience.

See [`docs/local-development/compose-services.md`](../local-development/compose-services.md) for startup instructions.

## Rationale

Option B (BFF with HTTP-only session cookie) is chosen because:

1. **Token isolation** — access and refresh tokens never reach browser JavaScript. XSS cannot steal tokens.
2. **Adapter isolation** — Keycloak SDK stays in `adapters-keycloak`. The React app and domain packages are IdP-agnostic.
3. **Clean session ownership** — BFF is the authoritative session authority. React app works with derived session state, not raw token claims.
4. **Simpler React implementation** — the React app does not manage token lifecycle or implement PKCE.

## Consequences

**Positive:**

- Access tokens are never exposed to browser JavaScript.
- Keycloak can be replaced by modifying `adapters-keycloak` without touching domain or React packages.
- Permissions are resolved server-side at login — no client-side permission computation from raw JWT claims.

**Negative:**

- BFF is a required runtime dependency. Serverless-only deployments need a thin BFF.
- Redis session store adds a runtime dependency (already present via `adapters-redis`).
- CSRF protection must be implemented alongside cookie-based auth.

**Neutral / operational:**

- Session TTL and token refresh strategy are operational decisions, not architecture decisions.
- The Keycloak Compose profile (`make compose-up-identity`) provides a local IdP for development.
- Login UI (login page, error display) is not in scope for the first vertical slice (ADR-ACT-0008). The first slice assumes an authenticated session already exists.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting
- Human review status: Reviewed by architecture owner
- Evidence checked: `docs/evidence/identity/identity-access-baseline.md`

## Validation / evidence

Evidence level: High

Evidence file: `docs/evidence/identity/identity-access-baseline.md`

## Impacted areas

- Security: HTTP-only session cookie; no token in browser JS storage.
- Architecture: `packages/contracts-auth` and `packages/domain-identity` are new packages.
- API: Every route requires BFF session derivation and permission enforcement.
- Delivery: Local Keycloak via Compose identity profile.
- Testing: Unauthenticated, authenticated-but-forbidden, and permitted test cases required for every protected route (ADR-ACT-0008 mandate).

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-28

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0021: Identity, tenancy, roles, and permissions model
- ADR-0017: Local integration substrate (Keycloak Compose profile)
- ADR-0020: RuntimeContext
- `docs/evidence/identity/identity-access-baseline.md`
- OAuth 2.0 RFC 6749: <https://datatracker.ietf.org/doc/html/rfc6749>
- OWASP Session Management: <https://owasp.org/www-community/attacks/Session_hijacking_attack>
- The BFF pattern: <https://samnewman.io/patterns/architectural/bff/>

## Notes

"Do not make login the first vertical slice" is a deliberate architecture decision. The first slice (ADR-ACT-0008) assumes an authenticated session and proves the full request → permission → domain → database → response stack. Login mechanics are a separate concern tracked in ADR-ACT-0106 and ADR-ACT-0108.

`packages/contracts-auth` is a new package following the zero-`@platform`-dependency contract pattern. It exports Zod schemas for `SessionActor`, login/logout request/response shapes, and `AuthError` subtypes. It must not import adapters, domain packages, or session implementations.
