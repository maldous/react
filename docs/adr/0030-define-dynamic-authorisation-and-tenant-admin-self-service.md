# ADR-0030: Define dynamic authorisation and tenant admin self-service

## Status

Accepted

## Date

2026-05-29

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0021 (identity, tenancy, roles, permissions)
- ADR-0022 (authentication, session, SSO boundary)
- ADR-0029 (multi-tenant isolation boundaries)

## Context

ADR-0029 establishes per-tenant Keycloak realms, identity brokering, and infrastructure isolation. The following requirements are not addressed there:

1. **Tenant admin self-service** ? tenant administrators must be able to configure all authentication-related settings (IdPs, MFA policies, session lifetimes, login flows) at runtime without requiring platform deployments or sysadmin intervention.

2. **Sysadmin cross-domain brokering** ? system administrators must be able to authenticate into any tenant's application using their `platform` realm credentials, subject to rules configured and allowed by that tenant.

3. **Dynamic per-resource authorisation** ? every protected resource (API route, feature, UI section) must have its own configurable auth policy (required roles, required MFA level, required IdP, time-based constraints), all changeable at runtime by the tenant admin. Changing a policy must not require a code deployment.

Without this ADR, auth policy is static: a route is protected by a hardcoded permission check, and changing that check requires a code change and deployment. This is insufficient for an enterprise platform where tenant security requirements evolve independently.

## Stakeholder concerns

- **Security:** Auth policy must be auditable. Every policy change must produce an audit record. Sysadmin cross-tenant access must be explicitly opted-in by the tenant.
- **Engineering:** No deployment should ever be required to change an auth policy for a resource. The platform codebase defines the set of available resources; the policies on those resources are data, not code.
- **Product:** Tenant admins must be able to manage auth from a platform UI ? not by navigating raw Keycloak admin screens.
- **Compliance:** Per-resource policies must be exportable for audit (what policy governs this resource? who approved it? when did it change?).

## Decision

The platform adopts the **Policy Enforcement Point (PEP)** pattern using Keycloak Authorization Services. All authorisation decisions for protected resources are evaluated at runtime by Keycloak, not hardcoded in the BFF. Tenant admins manage policies entirely within their realm with no platform intervention required.

---

### 1. Tenant admin self-service ? full realm control

#### 1a. Realm-admin role

On tenant provisioning, the initial `tenant-admin` user is granted the Keycloak built-in `realm-admin` role for their realm (`realms/tenant-{id}`). This grants full administrative control over the realm:

- Add, modify, and remove identity providers (OIDC, SAML, cross-tenant broker)
- Configure and test authentication flows (login flows, MFA flows, registration)
- Create and manage local user accounts
- Set password and MFA policies
- Configure session lifetimes and token settings
- Create and modify client scopes and claim mappers
- Configure Authorization Services (resources, policies, permissions)
- View realm events and login audit logs

The `realm-admin` role is scoped **exclusively to their realm**. The tenant admin cannot access or modify any other realm, the Keycloak server configuration, or other tenants' data.

Accessible via: `{slug}.aldous.info/kc/admin/tenant-{id}/console`

#### 1b. Platform Auth Settings API

The platform exposes a `GET/PATCH /api/auth/settings` endpoint family that wraps Keycloak's Admin REST API. This provides a tenant-friendly interface for the most common auth configuration operations, surfaced in the platform's own UI without requiring the tenant admin to use the Keycloak admin console directly.

Capabilities exposed via the platform Auth Settings API:

| Operation             | Keycloak Admin API endpoint                                       |
| --------------------- | ----------------------------------------------------------------- |
| List configured IdPs  | `GET /realms/{realm}/identity-provider/instances`                 |
| Add an OIDC IdP       | `POST /realms/{realm}/identity-provider/instances`                |
| Update IdP config     | `PUT /realms/{realm}/identity-provider/instances/{alias}`         |
| Remove an IdP         | `DELETE /realms/{realm}/identity-provider/instances/{alias}`      |
| Get MFA policy        | `GET /realms/{realm}` (otp policy fields)                         |
| Set MFA requirement   | `PUT /realms/{realm}` (otpPolicyType, otpPolicyAlgorithm, etc.)   |
| Get session config    | `GET /realms/{realm}` (token lifetime fields)                     |
| Set session config    | `PUT /realms/{realm}`                                             |
| List auth flows       | `GET /realms/{realm}/authentication/flows`                        |
| Get resource policies | `GET /realms/{realm}/clients/{id}/authz/resource-server/resource` |
| Set resource policy   | `PUT /realms/{realm}/clients/{id}/authz/resource-server/policy`   |

The platform Auth Settings API authenticates to Keycloak's Admin REST API using a **service account** with `realm-admin` rights ? not the tenant admin's personal credentials. The tenant admin authenticates to the **platform** (via their own session), and the platform proxies to Keycloak on their behalf. This means the tenant admin never needs a Keycloak service account or direct API access.

Every call through the Auth Settings API emits an audit event (`AuditEventPort`) recording: which admin made the change, what was changed, and the before/after state.

#### 1c. No deployment ever required

The Auth Settings API is backed entirely by Keycloak's runtime-mutable configuration. Policy changes, IdP additions, MFA flow updates, and resource permission changes all take effect immediately ? Keycloak evaluates them on the next request. Platform code defines the set of known resources; policies on those resources are data stored in Keycloak.

---

### 2. Sysadmin cross-domain brokering

#### 2a. Architecture

The `platform` super-admin Keycloak realm is registered as an OIDC Identity Provider option in each tenant realm. Whether it is enabled is controlled entirely by the tenant admin ? it is disabled by default and must be explicitly activated.

```text
system-admin logs in at acme.aldous.info
  ? clicks "Login with Platform Admin"
  ? acme realm redirects to platform realm for authentication
  ? platform realm authenticates the sysadmin (MFA required by platform realm policy)
  ? platform realm issues token to acme realm
  ? acme realm brokers: maps platform user ? acme realm user
  ? acme realm issues token to BFF
  ? BFF creates session with sysadmin context in acme's tenant schema
```

The sysadmin's brokered session in the tenant context:

- Uses the tenant's schema (`tenant_{id}`) for all data access
- Has a `Membership` record with `system-admin` role (pre-provisioned on tenant creation)
- Is subject to the tenant's RLS and session policies
- Is fully isolated from other tenants

#### 2b. Tenant control

The tenant admin controls sysadmin brokering via the platform Auth Settings API or directly via their Keycloak admin console:

```json
PATCH /api/auth/settings/sysadmin-brokering
{
  "enabled": true,
  "allowedRoles": ["system-admin"],
  "requireMfa": true,
  "auditAllAccess": true
}
```

When enabled, the platform registers the `platform` realm as an IdP in the tenant's realm. When disabled, the IdP is removed ? existing sysadmin sessions for that tenant are invalidated at the next token refresh.

#### 2c. Audit

Every sysadmin cross-domain login emits two audit events:

1. In the `platform` realm: "sysadmin authenticated for cross-domain access to tenant {slug}"
2. In the tenant's audit log: "system-admin {userId} logged in via cross-domain broker from platform realm"

Sysadmin access cannot be silently performed ? it is always visible in both the global platform audit log and the tenant's own audit log.

#### 2d. MFA enforcement

Platform realm policy requires MFA for all `system-admin` users before any cross-domain brokering can succeed. A sysadmin who has not completed MFA in the platform realm cannot broker into any tenant, regardless of that tenant's own MFA policy.

---

### 3. Dynamic per-resource authorisation ? Keycloak Authorization Services

#### 3a. Policy Enforcement Point (PEP) pattern

The BFF (`platform-api`) operates as a **Policy Enforcement Point** (PEP). It does not hardcode permission checks ? instead, it queries Keycloak's Authorization Server at runtime to determine whether the current actor can perform a specific action on a specific resource.

```text
Request arrives at platform-api
  ? BFF extracts session ? gets access token
  ? BFF sends UMA ticket request to Keycloak Authorization Server:
      POST /realms/{realm}/protocol/openid-connect/token
      grant_type=urn:ietf:params:oauth:grant-type:uma-ticket
      audience=platform-api
      permission={resource}#{scope}
  ? Keycloak evaluates all policies for resource+scope
  ? Returns RPT (Requesting Party Token) if granted, or 403 if denied
  ? BFF proceeds if granted; returns 403 with denial reason if not
```

This replaces the current hardcoded `permission && !actor.permissions.includes(permission)` check in the pipeline with a runtime Keycloak policy evaluation.

#### 3b. Resource registry

The platform defines a catalogue of resources in code ? the set of things that can be protected. Resources are registered in Keycloak on tenant provisioning (and on platform upgrades when new resources are added).

Platform resources follow a hierarchical naming convention:

```text
organisation:profile              ? organisation profile resource
organisation:members              ? member list resource
organisation:settings             ? organisation settings
feature:{feature-name}:read       ? feature read access
feature:{feature-name}:write      ? feature write access
api:{route-group}:{method}        ? specific API route groups
admin:users                       ? user management
admin:auth                        ? auth settings management
audit:read                        ? audit log access
```

Resources are registered using the Keycloak Admin API:

```typescript
await keycloakAdminClient.clients.createResource(realmId, clientId, {
  name: "organisation:profile",
  displayName: "Organisation Profile",
  type: "urn:platform:resources:organisation",
  scopes: [{ name: "read" }, { name: "write" }],
});
```

#### 3c. Policy types

Tenant admins can create the following policy types for any resource:

| Policy type       | Description                                 | Example                                          |
| ----------------- | ------------------------------------------- | ------------------------------------------------ |
| Role policy       | Requires one or more Keycloak realm roles   | Only `tenant-admin` can access `admin:auth`      |
| User policy       | Specific users explicitly allowed or denied | Named user always permitted to a resource        |
| Group policy      | Keycloak group membership required          | Only members of "Finance" group                  |
| Time policy       | Access permitted only within time windows   | Admin access only during business hours          |
| Aggregated policy | Combines other policies with AND/OR logic   | Role=tenant-admin AND recent-login               |
| Client policy     | Access from specific client only            | Only the BFF client, not mobile clients          |
| Regex policy      | Attribute matching                          | Only users whose email domain is `@acmecorp.com` |
| Custom JS policy  | JavaScript evaluation (Keycloak engine)     | Complex business rules evaluated server-side     |

Policies are created and managed via the Keycloak admin console or the platform Auth Settings API. They take effect on the next request ? no caching of policy decisions beyond the token lifetime.

#### 3d. Permission binding

A **Permission** binds a Resource + Scope to one or more Policies. Tenant admins configure permissions to define exactly what is required to access each resource.

Examples of runtime-configurable permissions:

```text
Resource: organisation:profile, Scope: write
  Policy: Role=tenant-admin OR Role=manager
  ? Only admins and managers can update the profile

Resource: admin:auth, Scope: write
  Policy: Role=tenant-admin AND Time=business-hours AND MFA-completed
  ? Auth settings can only be changed by admins during business hours after MFA

Resource: feature:reports, Scope: read
  Policy: Role=any AND IdP=corporate-entra
  ? Reports are only accessible to users who authenticated via Entra (not local accounts)

Resource: api:exports, Scope: write
  Policy: Role=tenant-admin AND Step-up-auth-required
  ? Exports require fresh authentication (step-up) even if already logged in
```

#### 3e. Step-up authentication

For resources that require a higher authentication level than the current session provides, Keycloak supports **step-up authentication**:

1. BFF checks resource access ? Keycloak denies with `insufficient_auth_level`
2. BFF redirects the browser to a Keycloak re-authentication flow (e.g., MFA challenge)
3. Keycloak issues a new token with elevated `acr` (Authentication Context Class Reference) claim
4. BFF retries the resource check with the elevated token
5. Access granted

The step-up flow is configured per resource by the tenant admin. The BFF handles the redirect and retry loop without any code changes ? it responds to the `insufficient_auth_level` denial code automatically.

#### 3f. Policy evaluation cache

Keycloak's RPT (Requesting Party Token) is cached in the BFF's request context for the duration of a single request ? not across requests. This means:

- Policy changes take effect on the next request (no stale policy cache)
- Each request performs at most one UMA ticket evaluation per resource check
- Multiple checks on the same resource within a request reuse the cached RPT

No persistent policy decision cache is maintained. This is intentional ? stale cached decisions are a security risk.

---

### 4. Keycloak Admin API proxy ? platform service account

The platform maintains a **service account** in each tenant's Keycloak realm with the `realm-admin` role. This service account is used exclusively by the platform's Auth Settings API (`/api/auth/settings/*`) to proxy admin operations on behalf of authenticated tenant admins.

The service account credentials are:

- Generated on tenant provisioning
- Stored in the platform's secret store (e.g., AWS Secrets Manager or Vault) keyed by `tenant/{organisationId}/keycloak-admin-sa`
- Rotated on a schedule (or on demand via the platform operator console)
- Never exposed to the tenant admin ? only used by the platform internally

The tenant admin authenticates to the **platform** via their normal session. The platform verifies they have `admin.access` permission + `admin:auth:write` resource permission before proxying any admin operation to Keycloak.

---

### 5. Invariants ? never violate without ADR amendment

1. **No hardcoded permission checks for resource access.** The BFF's resource protection uses UMA ticket evaluation, not inline `actor.permissions.includes(...)` comparisons. Inline checks may only be used for session-level guards (is the user authenticated? do they have any valid session?) ? not for business resource access.

2. **Tenant admins cannot escalate beyond their realm.** The realm-admin role is scoped to `realms/tenant-{id}`. The service account used by the Auth Settings API never holds server-admin or cross-realm rights.

3. **Sysadmin cross-domain brokering is opt-in.** The `platform` realm IdP is not registered in tenant realms by default. The tenant admin must explicitly enable it.

4. **Every auth settings change is audited.** Calls to the Auth Settings API emit audit events before proxying to Keycloak. If the audit emit fails, the operation is not proxied.

5. **Policy decisions are not cached across requests.** UMA ticket evaluations are per-request only. Stale policy caching is not permitted.

6. **MFA is required for sysadmin cross-domain access.** Platform realm enforces MFA for `system-admin` users unconditionally. This cannot be disabled from within a tenant realm.

7. **Resources are defined in platform code; policies are defined in Keycloak data.** The set of protectable resources is a code artifact (deployed). The policies applied to those resources are Keycloak data (runtime-mutable). Tenant admins can only configure policies on pre-registered resources ? they cannot create arbitrary resources.

---

### 6. Hexagonal package design

The new components introduced by this ADR must conform to the hexagonal architecture (ADR-0001). Ports define the interfaces; adapters implement them against Keycloak.

#### 6a. New port package ? `packages/authorisation-runtime`

Defines the resource authorisation port interface. Zero `@platform` dependencies (leaf node, like `packages/access-control`).

```typescript
// packages/authorisation-runtime/src/index.ts

export interface Resource {
  name: string; // e.g. "organisation:profile"
  scope: string; // e.g. "write"
}

export type AccessDecision =
  | { granted: true; rpt: string }
  | { granted: false; reason: "insufficient_scope" | "insufficient_auth_level" | "policy_denied" };

export interface AuthorisationPort {
  // Check whether the current token grants access to resource+scope.
  // Returns a Requesting Party Token (RPT) if granted.
  checkAccess(resource: Resource, token: string): Promise<AccessDecision>;
}

export interface RealmAdminPort {
  // Identity providers
  listIdentityProviders(): Promise<IdentityProvider[]>;
  upsertIdentityProvider(idp: IdentityProvider): Promise<void>;
  removeIdentityProvider(alias: string): Promise<void>;

  // MFA policy
  getMfaPolicy(): Promise<MfaPolicy>;
  setMfaPolicy(policy: MfaPolicy): Promise<void>;

  // Session policy
  getSessionPolicy(): Promise<SessionPolicy>;
  setSessionPolicy(policy: SessionPolicy): Promise<void>;

  // Resource policies
  getResourcePolicy(resource: string): Promise<ResourcePolicy[]>;
  setResourcePolicy(resource: string, policy: ResourcePolicy): Promise<void>;
}

export interface IdentityProvider {
  alias: string;
  displayName: string;
  providerId: "oidc" | "saml" | "keycloak-oidc";
  config: Record<string, string>;
  enabled: boolean;
}

export interface MfaPolicy {
  required: "none" | "optional" | "required";
  type: "totp" | "webauthn";
  gracePeriodSeconds?: number;
}

export interface SessionPolicy {
  accessTokenLifespanSeconds: number;
  ssoSessionIdleTimeoutSeconds: number;
  ssoSessionMaxLifespanSeconds: number;
}

export interface ResourcePolicy {
  name: string;
  type: "role" | "time" | "aggregated" | "user" | "group" | "regex" | "js";
  config: Record<string, unknown>;
}
```

#### 6b. Extend `packages/adapters-keycloak`

Two new classes added to the existing adapter package:

**`KeycloakAuthorisationAdapter`** ? implements `AuthorisationPort`:

```typescript
export class KeycloakAuthorisationAdapter implements AuthorisationPort {
  constructor(private readonly config: KeycloakClientConfig) {}

  async checkAccess(resource: Resource, token: string): Promise<AccessDecision> {
    const response = await fetch(
      `${this.config.url}/realms/${this.config.realm}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
          audience: this.config.clientId,
          permission: `${resource.name}#${resource.scope}`,
          response_include_resource_name: "false",
        }),
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (response.ok) {
      const { access_token } = await response.json();
      return { granted: true, rpt: access_token };
    }
    const error = await response.json().catch(() => ({}));
    const reason =
      error.error === "insufficient_scope"
        ? "insufficient_scope"
        : error.error_description?.includes("auth_level")
          ? "insufficient_auth_level"
          : "policy_denied";
    return { granted: false, reason };
  }
}
```

**`KeycloakRealmAdminAdapter`** ? implements `RealmAdminPort`:

Uses the Keycloak Admin REST API, authenticated via the per-tenant service account token. The service account credentials are resolved from the secret store (injected via config, never read from env directly in the adapter).

#### 6c. BFF pipeline update

The existing `pipeline.ts` replaces its inline permission check:

```typescript
// Before (hardcoded, static):
if (!actor.permissions.includes(matchingRoute.requiredPermission)) {
  return res.json(403, toSafeResponse(new ForbiddenError(...)));
}

// After (dynamic, Keycloak PEP):
const decision = await authorisationPort.checkAccess(
  { name: matchingRoute.resource, scope: matchingRoute.scope },
  req.context.accessToken
);
if (!decision.granted) {
  if (decision.reason === "insufficient_auth_level") {
    return res.json(401, { code: "STEP_UP_REQUIRED", ... });
  }
  return res.json(403, toSafeResponse(new ForbiddenError(...)));
}
```

Routes declare `resource` and `scope` instead of `requiredPermission`:

```typescript
// Before:
{ path: "/api/organisation/profile", method: "PATCH", requiredPermission: "organisation.update" }

// After:
{ path: "/api/organisation/profile", method: "PATCH", resource: "organisation:profile", scope: "write" }
```

#### 6d. Package boundary rules

`authorisation-runtime` follows the same boundary rules as other runtime packages:

- No `@platform` imports ? it is a leaf port package
- May be imported by: `platform` layer (BFF/server), `adapter` layer
- Must not be imported by: `domain`, `feature`, `ui`, `contract` packages

`adapters-keycloak` already exists in the adapter layer. The new classes added to it may import from `authorisation-runtime`.

---

## Rationale

**Keycloak Authorization Services (UMA)** is chosen because:

1. **Runtime mutability.** Policy changes take effect immediately without deployment. This is the fundamental requirement.

2. **No custom policy engine.** Keycloak provides role, user, group, time, aggregated, regex, and JavaScript policies out of the box. A custom policy engine would be significant engineering investment with worse coverage.

3. **Tenant self-service.** Policies are stored as Keycloak realm data ? each tenant's policies are completely isolated in their realm. The tenant admin has full control without touching other tenants.

4. **Standard protocol.** UMA 2.0 is an IETF standard. The BFF's PEP role is a well-understood integration pattern.

5. **Sysadmin brokering fits naturally.** Cross-realm identity brokering is a Keycloak feature. The sysadmin cross-domain flow requires no custom code ? it is configuration in Keycloak.

### Alternative considered: platform-managed policy store

A platform-owned database table storing resource policies, evaluated by the BFF.

Rejected because:

- Duplicates Keycloak's authorisation engine.
- Policies would be stored separately from the identity system, creating a consistency gap.
- Tenant admin management would require building a custom policy editor.
- Step-up authentication integration would require custom protocol work.

## Consequences

**Positive:**

- Zero deployments ever needed for auth policy changes.
- Tenant admins have complete, audited control over their auth configuration.
- Per-resource policies support the full spectrum: role, time, IdP, MFA, step-up.
- Sysadmin cross-tenant access is tenant-controlled, audited, and MFA-gated.

**Negative:**

- UMA ticket evaluation adds one Keycloak round-trip per resource check per request. This must be optimised with efficient token reuse within a request.
- Keycloak Authorization Services must be enabled on every tenant's BFF client on provisioning ? adds a provisioning step.
- The service account per tenant realm must be managed (provisioned, rotated, secured) ? adds secret management complexity.
- JavaScript policies in Keycloak execute server-side in Keycloak's Nashorn/Graal engine ? a security review is required if tenants are permitted to write custom JS policies.

**Operational:**

- Platform operators must monitor UMA evaluation latency as a performance signal.
- Platform upgrades that add new resources must apply the resource registration to all existing tenant realms (migration runner pattern, same as DB migrations).
- Keycloak's `realm-admin` role grants significant power to the tenant admin ? the scope (restricted to their realm) must be confirmed on every Keycloak major version upgrade.

## Migration path from current state

1. Enable Keycloak Authorization Services on the BFF client in the local dev realm.
2. Register the initial set of platform resources in the Keycloak module (Terraform + Keycloak Admin API calls on provisioning).
3. Replace BFF inline permission checks with UMA ticket evaluation in the request pipeline.
4. Implement Auth Settings API (`/api/auth/settings/*`) as a Keycloak Admin API proxy.
5. Implement sysadmin cross-domain brokering: register `platform` realm as optional IdP in tenant realms.
6. Add resource policy management to the Terraform Keycloak module (default policies matching current permission table).
7. Update E2E tests to verify policy changes take effect without deployment.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting and architecture recommendation
- Human review status: Reviewed by architecture owner

## Validation / evidence

Evidence level: Decision ? implementation evidence tracked in ACTION-REGISTER.

## Impacted areas

- `apps/platform-api/src/server/pipeline.ts`: replace inline permission checks with UMA ticket evaluation
- New: `apps/platform-api/src/server/authz.ts`: UMA ticket evaluation client
- New: `apps/platform-api/src/server/routes/auth-settings.ts`: Auth Settings API proxy
- Keycloak Terraform module: Authorization Services, resource registration, service account
- Secret management: Keycloak admin service account per tenant realm
- `packages/adapters-keycloak`: add UMA ticket evaluation + Admin API client methods
- Tiltfile: no change (Keycloak provisioning already handles this)
- E2E tests: add tests for runtime policy change ? immediate effect verification

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-29

## Supersedes

None. Extends ADR-0029 (multi-tenant isolation boundaries) and ADR-0022 (authentication, session, SSO boundary).

## Superseded by

None.

## References

- ADR-0021: Identity, tenancy, roles, permissions
- ADR-0022: Authentication, session, SSO boundary
- ADR-0029: Multi-tenant isolation boundaries
- Keycloak Authorization Services: [server_admin authz](https://www.keycloak.org/docs/latest/server_admin/#_authorization_services)
- UMA 2.0 specification: [oauth.net/uma](https://oauth.net/uma/)
- Keycloak UMA ticket endpoint: [keycloak.org/authorization_services](https://www.keycloak.org/docs/latest/authorization_services/#_service_obtaining_permissions)
- OWASP Authorization Cheat Sheet: [owasp.org/authz](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

---

## Amendment: UMA Enforcement Implemented (2026-06-01)

**Status of runtime UMA enforcement:** IMPLEMENTED — see ADR-ACT-0145 Done in ACTION-REGISTER.

The pipeline now calls `KeycloakAuthorisationAdapter.checkAccess()` for every route that declares `resource` + `umaScope`. Static `requiredPermission` checks are retained as a backstop during migration and on Keycloak unavailability. The fail-closed invariant is enforced: if UMA is the sole gate and evaluation fails, the request is denied (never silently allowed).

---

## Amendment: Static Enforcement Interim (2026-05-31)

**Status of runtime UMA enforcement (original):** Superseded by 2026-06-01 amendment above.

The decision above (full Keycloak Authorization Services / UMA ticket evaluation) remains the architectural target. However, the current implementation uses **static permission enforcement** only:

```typescript
if (
  matchingRoute.requiredPermission &&
  !actor.permissions.includes(matchingRoute.requiredPermission)
) {
  return 403;
}
```

This means:

- Permission changes require a code/config deploy (not a Keycloak policy update).
- No UMA resource/scope evaluation occurs at runtime.
- The "no-deploy policy changes" claim from the original ADR is **not satisfied**.
- The `AuthorisationPort` / Keycloak UMA adapter does not exist yet.

**What IS implemented:**

- Permissions are resolved from roles at session creation time via `resolvePermissions()` in `@platform/domain-identity`.
- Roles are asserted from the Keycloak JWT at login via the auth callback.
- Static permission checks on every route via the `requiredPermission` field in `pipeline.ts`.
- Route scope enforcement (`scope: "global" | "tenant"`) ensures global routes can only be called from the apex host and tenant routes require a tenant FQDN — enforced in `pipeline.ts` without UMA.
- Per-tenant Keycloak realm isolation — each tenant has its own realm.
- Permissions are now split: `platform.*` for system-admin only, `tenant.*` for tenant-admin only. `admin.access` is removed.

**Tracked in ACTION-REGISTER as:** ADR-ACT-0145 (UMA enforcement), ADR-ACT-0153 (access token in session).

The static enforcement is intentional and safe as a baseline. It will be replaced by UMA when ADR-ACT-0145 is complete.

**Auth Settings Keycloak service account:** Routes in `GET/POST /api/auth/settings/*` use `KEYCLOAK_PROVISIONER_CLIENT_ID` / `KEYCLOAK_PROVISIONER_SECRET` (the `platform-provisioner` client). This client is granted `realm-management` roles only in each tenant realm during provisioning — not in the master realm. Therefore it cannot manage other realms or server-level configuration. A dedicated per-tenant service account stored in tenant secret storage remains future work tracked in ACTION-REGISTER.
