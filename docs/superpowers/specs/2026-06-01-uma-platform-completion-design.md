# Platform Completion: UMA + Dynamic Authorisation Design

**Date:** 2026-06-01
**ADRs:** ADR-0030 (UMA), ADR-0022 (session boundary), ADR-ACT-0145, ADR-ACT-0153, ADR-ACT-0151, ADR-ACT-0143, ADR-ACT-0162, ADR-ACT-0141

---

## 1. Scope

Deliver a complete, production-ready multi-tenant SaaS control-plane with:

- Runtime dynamic authorisation via Keycloak UMA 2.0 (replaces all static permission checks)
- Encrypted token storage in session (ADR-0022 amendment)
- Tenant admin self-service resource policy management
- Vanity domain support wiring
- Repository interface migration to correct layer
- All remaining Critical/High open action items closed

---

## 2. Architecture

### 2.1 Policy Enforcement Point (PEP) Pattern

Every protected route in the BFF pipeline is evaluated at runtime by Keycloak Authorization Services. The BFF sends a UMA ticket request (permission=`resource#scope`) using the actor's current access token. Keycloak evaluates all configured policies for that resource+scope combination and returns an RPT (Requesting Party Token) on success or a denial reason on failure.

This replaces all `actor.permissions.includes(requiredPermission)` static checks.

````text
Request → pipeline.ts → canAccessTenantFqdn() → token-refresh-if-expired
  → authorisationPort.checkAccess({ name, scope }, accessToken)
  → Keycloak UMA endpoint → policy evaluation → AccessDecision
  → granted: proceed | denied: 403/401/503
```text

### 2.2 Token Storage (ADR-0022 Amendment)

**Decision:** Store encrypted access token + refresh token + expiry in SessionRecord.

**Rationale:** ADR-0022 prohibited "raw tokens" to prevent token theft from a compromised session store. AES-256-GCM encryption with a dedicated key (TENANT_SECRET_ENCRYPTION_KEY, already in use for ADR-ACT-0186) provides equivalent protection to not storing them, while enabling runtime UMA calls without an extra Keycloak round-trip on every login.

**Fields added to SessionRecord / CreateSessionCommand:**

- `accessTokenEnc?: string` — AES-256-GCM encrypted access token (same format as credential store: `enc:<iv_hex>:<ct_hex>:<tag_hex>`)
- `accessTokenExpiresAt?: Date` — when to refresh
- `refreshTokenEnc?: string` — encrypted refresh token

**Refresh flow:** If `Date.now() >= accessTokenExpiresAt - 30s`, call Keycloak `/token` endpoint with `grant_type=refresh_token`, update session record with new encrypted tokens, proceed with UMA check using fresh token. On refresh failure: destroy session, return 401.

**Fixture sessions:** Have no access token. When `LOCAL_FIXTURE_SESSION` is set or no `accessTokenEnc` present, skip UMA and fall back to static permission check. This preserves all existing E2E/unit test paths.

### 2.3 Resource Registry

Platform resources registered in Keycloak on provisioning. Default policies match current static permission table — no access-control behaviour change on day 1.

| Resource Name          | Scopes                               | Current requiredPermission mapping                   |
| ---------------------- | ------------------------------------ | ---------------------------------------------------- |
| `organisation:profile` | `read`, `write`                      | `organisation.read`, `organisation.update`           |
| `organisation:members` | `read`, `invite`, `update_role`      | `member.read`, `member.invite`, `member.update_role` |
| `admin:auth`           | `read`, `write`                      | `tenant.auth.settings.read/write`                    |
| `admin:tenants`        | `create`, `read`, `update`, `delete` | `platform.tenants.*`                                 |
| `platform:admin`       | `access`                             | `platform.admin.access`                              |
| `profile:self`         | `read`, `write`                      | `profile.read_self`, `profile.update_self`           |
| `audit:platform`       | `read`                               | `platform.audit.read_all`                            |
| `audit:tenant`         | `read`                               | `tenant.audit.read`                                  |
| `platform:support`     | `enter`                              | `platform.admin.access` (support session)            |

### 2.4 Route Model

`Route` interface gains two optional fields alongside the existing `requiredPermission` (kept for backward compat):

```typescript
interface Route {
  // Existing (kept during migration, removed after UMA verified)
  requiredPermission?: string;
  // New UMA fields
  resource?: string; // e.g. "organisation:profile"
  umaScope?: string; // e.g. "write"
}
```text

Pipeline evaluation order:

1. If `resource` + `umaScope` present AND actor has `accessTokenEnc` → UMA check
2. Else if `requiredPermission` present → static check (backward compat)
3. If both present → UMA takes precedence; static is backstop during migration

### 2.5 Pipeline UMA Integration

```typescript
// In pipeline.ts, after FQDN cross-check, before route dispatch:
if (matchingRoute.resource && actor.accessTokenEnc) {
  const token = await resolveAccessToken(actor, sessionId, getSessionStore());
  if (!token) { return 401 UNAUTHENTICATED (session expired/refresh failed) }
  const decision = await getAuthorisationPort(fqdnTenant).checkAccess(
    { name: matchingRoute.resource, scope: matchingRoute.umaScope ?? "read" },
    token
  );
  if (!decision.granted) {
    if (decision.reason === "insufficient_auth_level") return 401 STEP_UP_REQUIRED
    if (decision.reason === "keycloak_unavailable") return 503 SERVICE_UNAVAILABLE
    return 403 FORBIDDEN
  }
} else if (matchingRoute.requiredPermission) {
  // existing static check — unchanged
}
```text

`getAuthorisationPort(fqdnTenant)` returns:

- Fixture mode: `createAllowAllAuthorisationPort()` (already exists in authorisation-runtime)
- Tenant FQDN: `new KeycloakAuthorisationAdapter(getKeycloakConfigForRealm(fqdnTenant.realmName))`
- Global (no tenant): `new KeycloakAuthorisationAdapter(getKeycloakConfig())` (platform realm)

### 2.6 Keycloak Terraform Changes

```hcl
resource "keycloak_openid_client" "bff" {
  # ... existing fields ...
  authorization_services_enabled = true   # NEW — enables UMA on this client
  service_accounts_enabled       = true   # NEW — needed for Authorization Services
}
```text

Resource + default policy registration via `KeycloakProvisioningAdapter.registerPlatformResources()` called during `provisionTenant()` and during initial platform realm setup.

### 2.7 Tenant Admin Policy Management API

```text
POST   /api/admin/resource-policies          scope:global, platform.admin.access
GET    /api/auth/settings/resource-policies  scope:tenant, tenant.auth.settings.read
PATCH  /api/auth/settings/resource-policies  scope:tenant, tenant.auth.settings.write
```text

These wrap Keycloak Authorization Services resource/policy management. The GET/PATCH tenant routes use the per-tenant auth-settings credential (ADR-ACT-0186). The global POST is for platform-level resource registration.

Unlocks ADR-ACT-0151 (resource policy stubs replaced with real implementation).

### 2.8 Vanity Domain Support (ADR-ACT-0162)

```text
POST /api/auth/settings/domains   scope:tenant, tenant.auth.settings.write
DELETE /api/auth/settings/domains/:domain
```text

Calls Keycloak Admin API to add/remove `customDomain` to tenant realm's BFF client `redirect_uris` and `web_origins`. Uses per-tenant auth-settings credential. No Terraform apply required at runtime.

### 2.9 Repository Port Migration (ADR-ACT-0141)

Move `IdentityRepository` and `OrganisationRepository` interfaces from `packages/adapters-postgres/src/ports.ts` to `packages/contracts-auth` and `packages/contracts-organisation` respectively. Implementations stay in `adapters-postgres`. The `apps/platform-api/src/ports/` re-export layer is simplified.

---

## 3. Implementation Slices (Ordered by Dependency)

### Slice 1: Token Storage (ADR-ACT-0153 prerequisite)

- Extend `SessionRecord` + `CreateSessionCommand` with encrypted token fields
- `resolveSessionFromIdentity()` stores encrypted tokens from auth callback
- `resolveAccessToken(actor, sessionId, sessionStore)` helper: decrypt, check expiry, refresh if needed, re-encrypt and update session
- Redis adapter picks up new fields via spread (existing pattern)
- `ADR-0022` amendment committed
- Tests: unit tests for token encrypt/decrypt, refresh flow, expired token handling

### Slice 2: Keycloak Infrastructure

- Terraform: `authorization_services_enabled = true`, `service_accounts_enabled = true` on BFF client
- `KeycloakProvisioningAdapter.registerPlatformResources()`: registers all 9 resources with default role policies matching current permission table
- Called from `provisionTenant()` (tenant realm resources) and from a new `setupPlatformRealm()` helper (platform realm)
- Tests: integration test against live Keycloak (Compose-backed)

### Slice 3: Pipeline PEP (canary + full rollout)

- `getAuthorisationPort()` factory in `dependencies.ts`
- Pipeline updated with UMA check block (before static check)
- `canary:` Add `resource` + `umaScope` to one low-risk route (GET `/api/organisation/profile`)
- Verify behaviour with allow-all and deny-all adapters
- Full rollout: all 14 routes get `resource` + `umaScope`
- Tests: pure unit tests with injected ports (no Keycloak needed)

### Slice 4: Step-Up Auth + Token Refresh UX

- `STEP_UP_REQUIRED` response shape with `keycloakAuthUrl` for client redirect
- Token refresh on 401 from UMA endpoint
- Session invalidation on refresh failure
- Tests: unit test for each denial reason path

### Slice 5: Tenant Policy Management API

- `GET/PATCH /api/auth/settings/resource-policies` — tenant admin can view/update resource policies for their realm
- `POST /api/admin/resource-policies` — sysadmin registers new resources platform-wide
- Implements ADR-ACT-0151 (replace NOOP stubs)
- Tests: unit tests + integration against real Keycloak

### Slice 6: Vanity Domain Support (ADR-ACT-0162)

- `POST/DELETE /api/auth/settings/domains` — runtime redirect_uri management
- No deployment needed for tenant custom domains
- Tests: unit tests with mock Keycloak Admin API

### Slice 7: Repository Port Migration (ADR-ACT-0141)

- Move `IdentityRepository` to `packages/contracts-auth`
- Move `OrganisationRepository` to `packages/contracts-organisation`
- Update all import paths
- Tests: no behaviour change, TypeScript gate sufficient

### Slice 8: Remaining Open Actions

- ADR-ACT-0143: hierarchical tenant admin provisioning (`POST /api/admin/sub-tenants` currently stubs)
- ADR-ACT-0016, ADR-ACT-0032, ADR-ACT-0038: governance/doc actions

---

## 4. Error Handling

| UMA result                | HTTP    | Body code           | Description                   |
| ------------------------- | ------- | ------------------- | ----------------------------- |
| `granted`                 | proceed | —                   | RPT issued, request continues |
| `insufficient_scope`      | 403     | FORBIDDEN           | Policy evaluation denied      |
| `policy_denied`           | 403     | FORBIDDEN           | Policy evaluation denied      |
| `insufficient_auth_level` | 401     | STEP_UP_REQUIRED    | MFA/step-up needed            |
| `no_session`              | 401     | UNAUTHENTICATED     | Token missing or expired      |
| Keycloak fetch throws     | 503     | SERVICE_UNAVAILABLE | Admin API unreachable         |
| Token refresh fails       | 401     | SESSION_EXPIRED     | Force re-login                |

---

## 5. Testing Strategy

**Unit tests (no Keycloak, no Redis):**

- Token encrypt/decrypt roundtrip
- `resolveAccessToken()`: fresh token, expired token, refresh success, refresh failure
- Pipeline: UMA granted path, each denied reason, fixture bypass, no-token fallback
- Each new route with injected allow/deny adapters
- Policy management usecase with fake Keycloak admin calls

**Substrate tests (Compose-backed Redis/Postgres, no Keycloak):**

- SessionRecord round-trip with encrypted tokens
- Auth routes still work (existing tests unbroken)

**Integration tests (Compose + real Keycloak):**

- UMA ticket returns RPT for provisioned user with matching policy
- Policy change takes effect immediately (next request, no restart)
- Refresh flow: use refresh token when access token expires
- Vanity domain: add/remove redirect_uri at runtime

**E2E (full Playwright stack):**

- Login → protected route → 200 (policy allows)
- Runtime policy tightening → 403 on next request
- Tenant admin changes own auth policy → immediate effect

---

## 6. ADR Amendments Required

- **ADR-0022**: Add section documenting encrypted token storage as resolved approach, referencing ADR-ACT-0186 encryption pattern. Keep the intent ("no raw token exposure") while clarifying "encrypted-at-rest in session store is acceptable."
- **ADR-0030**: Update amendment block: UMA enforcement implemented, static checks removed. Mark implementation complete.

---

## 7. Files Changed (Anticipated)

| File                                                       | Change                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/session-runtime/src/index.ts`                    | Add `accessTokenEnc`, `accessTokenExpiresAt`, `refreshTokenEnc`        |
| `packages/adapters-redis/src/index.ts`                     | `create()` persists encrypted token fields                             |
| `apps/platform-api/src/usecases/auth.ts`                   | Store encrypted tokens in `resolveSessionFromIdentity()`               |
| `apps/platform-api/src/server/auth.ts`                     | Pass tokens from `exchangeCodeForTokens` into session creation         |
| `apps/platform-api/src/server/dependencies.ts`             | `getAuthorisationPort()` factory; `resolveAccessToken()` helper        |
| `apps/platform-api/src/server/pipeline.ts`                 | UMA check block; Route interface adds `resource?`, `umaScope?`         |
| `apps/platform-api/src/server/routes.ts`                   | All routes gain `resource` + `umaScope`                                |
| `packages/adapters-keycloak/src/index.ts`                  | `registerPlatformResources()`; resource policy methods (replace stubs) |
| `infra/modules/keycloak/main.tf`                           | `authorization_services_enabled`, `service_accounts_enabled` on BFF    |
| `apps/platform-api/src/server/provisioning.ts`             | Call `registerPlatformResources()`                                     |
| New: `apps/platform-api/src/usecases/resource-policies.ts` | Policy management usecase                                              |
| New: `apps/platform-api/src/usecases/vanity-domain.ts`     | Vanity domain usecase                                                  |
| `packages/contracts-auth/src/index.ts`                     | Export `IdentityRepository` interface (ADR-ACT-0141)                   |
| `docs/adr/0022*.md`                                        | Amendment: encrypted token storage                                     |
| `docs/adr/0030*.md`                                        | Amendment: UMA implemented                                             |
| `docs/adr/ACTION-REGISTER.md`                              | Close ADR-ACT-0145, 0153, 0151, 0162, 0141                             |
````
