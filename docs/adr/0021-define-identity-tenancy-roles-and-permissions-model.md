# ADR-0021: Define identity, tenancy, roles, and permissions model

## Status

Accepted

## Date

2026-05-28

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture ? domain models own rules)
- ADR-0002 (bounded contexts ? core domain)
- ADR-0003 (modular monorepo)
- ADR-0013 (client-facing API boundary)
- ADR-0019 (React component platform ? UI permission checks are convenience only)
- ADR-0020 (RuntimeContext ? actorId, tenantId, roles, permissions)
- ADR-0022 (authentication and session boundary)

## Context

The first vertical slice (ADR-ACT-0008) proves the full request/response/permission stack through a protected organisation profile route. Without a ratified identity and permissions model, feature developers will make ad-hoc decisions about:

- What an "authenticated user" means across packages
- Whether role checks or permission checks enforce behaviour
- How multi-tenancy scopes access
- Where the source of truth for permissions lives

This ADR establishes the canonical identity model before any feature code is written. It intentionally defers implementation to ADR-ACT-0105 and subsequent actions.

The existing `packages/access-control` package (interface, zero `@platform` deps) and `packages/adapters-keycloak` (Keycloak-specific integration) are the delivery points for this model's implementation.

## Stakeholder concerns

- **Security:** Permissions must be the authoritative enforcement primitive. Role checks are a convenience shorthand; they must not bypass permission enforcement at the API or use-case layer.
- **Engineering:** Multi-tenancy must be explicit in every scoped operation. No implicit "current user has access" assumptions.
- **Product:** The role model must be simple enough to reason about without reading source code ? five roles with clear semantics.
- **Architecture:** External identity (Keycloak JWT) must not pollute the domain model. A user in the domain is not the same as an SSO principal.
- **Compliance:** All permission checks must be auditable through the structured log/trace stack (ADR-0020).

## Decision drivers

1. External identity (SSO token) and internal user identity must be decoupled ? the same person may log in from multiple providers.
2. Permissions are atomic and the authoritative enforcement point. Roles are convenience bundles of permissions.
3. All access is tenant-scoped by default. Global roles are explicit exceptions.
4. The domain model must not depend on HTTP, SSO libraries, or session implementations.
5. RuntimeContext (ADR-0020) carries safe actor context ? actorId, tenantId, resolved permissions ? not raw tokens.

## Options considered

### Option A: Role-based access control (RBAC) only

Assign roles; check `user.hasRole("tenant-admin")` everywhere.

Pros: Simple. Widely understood.

Cons:

- Roles conflate business access with product-level groupings.
- Adding a new role to cover a partial access pattern requires code changes at every check site.
- Role checks in UI and API tend to diverge.

### Option B: Attribute-based access control (ABAC)

Full policy language (OPA, Casbin) evaluating attributes, resources, and environment.

Pros: Maximum flexibility.

Cons:

- Significant operational complexity before the first slice.
- Policy debugging is non-trivial.
- Over-engineered for the baseline use case.

### Option C: Permission-first RBAC with tenant scoping (chosen)

Permissions are the enforcement primitive. Roles are convenience bundles. Five tenant-scoped roles plus one global role. Permissions flow through RuntimeContext.

Pros:

- Adding new permissions does not require new roles.
- Role checks remain available as a readable shorthand.
- Simple enough to audit by reading the permission list.
- Scales to ABAC later by enriching the permission resolution step.

Cons:

- Every use case must check the correct permission, not just the role.

## Decision

---

### 1. Identity entities

#### User

The internal platform identity. Created once per person, independent of any SSO provider.

```typescript
interface User {
  id: string; // stable UUID
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### ExternalIdentity

Maps a specific SSO provider's subject identifier to an internal User. A User may have multiple ExternalIdentities (e.g., Keycloak + future GitHub SSO).

```typescript
interface ExternalIdentity {
  id: string;
  userId: string; // FK to User
  provider: string; // "keycloak" | "github" | ...
  providerSubject: string; // provider-specific subject claim
  createdAt: Date;
}
```

#### Organisation (Tenant)

The multi-tenant boundary. All scoped resources belong to an Organisation.

```typescript
interface Organisation {
  id: string; // tenantId / organisationId
  slug: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### Membership

A User's relationship to an Organisation, including their Role within that Organisation.

```typescript
interface Membership {
  id: string;
  userId: string;
  organisationId: string;
  role: TenantScopedRole;
  createdAt: Date;
  updatedAt: Date;
}
```

**Role** ? see ?2 below.

**Permission** ? see ?3 below.

#### SessionActor

The runtime-safe projection of an authenticated actor's identity. Carried by RuntimeContext (ADR-0020). Does not contain raw tokens, credentials, or provider-specific data.

```typescript
interface SessionActor {
  userId: string;
  tenantId: string; // resolved from active Membership
  organisationId: string; // same as tenantId
  roles: string[]; // e.g. ["tenant-admin"]
  permissions: string[]; // resolved from roles for this tenant
  displayName: string; // safe for logging
}
```

---

### 2. Role model

**Rule: A User gains access through Membership. Roles are assigned through Membership.**

#### Global roles (cross-tenant)

| Role           | Semantics                                                      |
| -------------- | -------------------------------------------------------------- |
| `system-admin` | Full access across all tenants. Not assignable via product UI. |

#### Tenant-scoped roles (per Membership)

| Role           | Semantics                                                           |
| -------------- | ------------------------------------------------------------------- |
| `tenant-admin` | Full control within the organisation. Manages members and settings. |
| `manager`      | Can manage members below their level; cannot change org settings.   |
| `member`       | Standard access to product features.                                |
| `viewer`       | Read-only access. Cannot perform write operations.                  |

**Rules:**

- `system-admin` is a global role. It does not require a Membership record.
- All other roles are tenant-scoped ? they apply only within the Organisation identified by the Membership.
- Role checks may be used for convenience (e.g., "only show the admin panel to `tenant-admin`"), but **permission checks are the authoritative enforcement primitive**.
- A role check that bypasses a permission check is an architecture violation.

---

### 3. Permission model

**Rule: Permissions are the authoritative enforcement primitive. Use cases enforce permissions. Roles are bundles.**

#### Baseline permissions

| Permission            | Description                                 |
| --------------------- | ------------------------------------------- |
| `organisation.read`   | Read organisation profile and settings      |
| `organisation.update` | Edit organisation display name and settings |
| `member.read`         | View membership list                        |
| `member.invite`       | Invite a new member to the organisation     |
| `member.update_role`  | Change a member's role                      |
| `profile.read_self`   | Read own user profile                       |
| `profile.update_self` | Update own user profile                     |
| `admin.access`        | Access admin-only functionality             |
| `audit.read`          | Read audit log                              |

#### Default role-to-permission mapping

| Permission            | system-admin | tenant-admin | manager | member | viewer |
| --------------------- | ------------ | ------------ | ------- | ------ | ------ |
| `organisation.read`   | ?            | ?            | ?       | ?      | ?      |
| `organisation.update` | ?            | ?            | ?       | ?      | ?      |
| `member.read`         | ?            | ?            | ?       | ?      | ?      |
| `member.invite`       | ?            | ?            | ?       | ?      | ?      |
| `member.update_role`  | ?            | ?            | ?       | ?      | ?      |
| `profile.read_self`   | ?            | ?            | ?       | ?      | ?      |
| `profile.update_self` | ?            | ?            | ?       | ?      | ?      |
| `admin.access`        | ?            | ?            | ?       | ?      | ?      |
| `audit.read`          | ?            | ?            | ?       | ?      | ?      |

---

### 4. Enforcement rules

**UI layer:**

- May use permissions to show/hide controls (convenience, not enforcement).
- UI checks are derived from `SessionActor.permissions` in RuntimeContext.
- A missing UI control does not replace a server-side permission check.

**API layer (BFF/server routes):**

- Must check the appropriate permission before processing the request.
- Returns `UnauthorizedError` (401) if no valid session.
- Returns `ForbiddenError` (403) if session exists but permission is missing.
- Enforces `tenantId` from session ? never from client-supplied parameters alone.

**Use-case layer:**

- Must check business permissions before executing domain operations.
- Never trusts frontend-only checks.
- Receives `RuntimeContext` with resolved `permissions` and `tenantId`.

**Domain layer:**

- Must not import access-control, session, or HTTP packages.
- May receive a resolved actor context as a plain value object if needed.
- Domain logic describes _what is valid_, not _who is allowed_.

**Tenancy rule:**

- `tenantId` / `organisationId` must be explicit in every scoped operation.
- There is no "current user's default org" implicit in any API or use case.
- The BFF derives the active tenant from the authenticated session; it is never accepted raw from the request body.

---

### 5. Package delivery

| Package                             | Responsibility                                                              |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `packages/domain-identity`          | User, Organisation, Membership, ExternalIdentity domain models and rules    |
| `packages/access-control`           | Permission check interface (existing leaf node, zero `@platform` deps)      |
| `packages/contracts-auth`           | Safe auth/session contracts: SessionActor type, login/logout request shapes |
| `packages/platform-runtime-context` | Carries `SessionActor` as part of RuntimeContext (ADR-0020)                 |
| `packages/adapters-keycloak`        | Keycloak-specific SSO integration and token exchange                        |
| `packages/session-runtime`          | BFF session management (existing)                                           |

---

## Rationale

Option C is chosen because:

1. **Permission granularity without ABAC complexity.** The permission list is small enough to audit in seconds. Roles remain useful for product UI but do not gate enforcement.

2. **Explicit tenancy.** No implicit "current user's org." Every scoped operation requires an explicit `tenantId` derived from the authenticated session. This prevents accidental cross-tenant data access.

3. **Clean IdP separation.** `ExternalIdentity` as a separate entity means the domain model survives a future IdP migration. `User` is the stable identity; `ExternalIdentity` is a transient mapping.

4. **Scales to ABAC.** The permission resolution step (role ? permissions via Membership) can be enriched with resource-level or environment-level attributes later, without changing the enforcement API.

## Consequences

**Positive:**

- Enforcement is auditable: every protected operation checks a named permission, visible in logs.
- New permissions can be added without new roles or schema changes.
- The IdP is replaceable without changing domain models.

**Negative:**

- Every use case must explicitly check a permission, not just check role membership.
- Resolving permissions from roles adds a database lookup or cache step per request.

**Neutral / operational:**

- `system-admin` is assigned out-of-band (not via product UI) to prevent privilege escalation through the product.
- Permission resolution must be cached (Redis) at request scope to avoid per-operation database round-trips.
- The permission list is the single source of truth; it must be documented and versioned.

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

- Architecture: New domain packages (`domain-identity`, `contracts-auth`) and boundary updates.
- Security: Permission-first enforcement across API and use-case layers.
- API: Every route requires session derivation and permission check.
- Data: User, ExternalIdentity, Organisation, Membership tables required before first slice.
- Testing: Allowed, forbidden, and unauthenticated cases must be tested for every protected route.
- Documentation: Permission list is versioned governance ? changes require ADR amendment or new ADR.

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
- ADR-0002: Bounded contexts ? core domain
- ADR-0013: Client-facing API boundary
- ADR-0020: RuntimeContext ? actorId, tenantId, permissions
- ADR-0022: Authentication, session, and SSO integration boundary
- `docs/evidence/identity/identity-access-baseline.md`
- OWASP Broken Access Control: <https://owasp.org/Top10/A01_2021-Broken_Access_Control/>

## Notes

The `SessionActor` type is intentionally a plain value object with no methods. It is a snapshot of the resolved actor context at request time. It must never be mutated during a request lifecycle.

The `system-admin` role is not assignable via the product UI. It must be assigned directly through a migration or admin script with an explicit audit trail. This prevents a `tenant-admin` from escalating to global admin through the product.

`domain-identity` is a new package. The existing `packages/access-control` package remains the permission-check interface (zero `@platform` deps per the existing architecture). `domain-identity` uses `access-control` abstractions, not the reverse.
