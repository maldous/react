# ADR-0029: Define multi-tenant isolation boundaries

## Status

Accepted

## Date

2026-05-29

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0001 (hexagonal architecture)
- ADR-0002 (bounded contexts)
- ADR-0013 (client-facing API boundary)
- ADR-0014 (transactional data ownership)
- ADR-0020 (RuntimeContext ? actorId, tenantId)
- ADR-0021 (identity, tenancy, roles, permissions)
- ADR-0022 (authentication, session, SSO boundary)
- ADR-0028 (GraphQL schema boundary)
- ADR-0033 (environment-specific domain configuration ? APEX_DOMAIN determines the base domain for all tenant FQDNs)

## Context

ADR-0021 establishes that all access is tenant-scoped and that `tenantId` must be explicit in every scoped operation. That ADR defines the identity model and application-layer enforcement rules. It does not define how isolation is enforced at the infrastructure layer, how tenants are routed, or how each tenant configures their own identity and branding.

As the platform accepts enterprise tenant consumers, the following requirements must be satisfied:

1. **No cross-tenant data leakage** ? even if application code contains a bug, no infrastructure layer allows one tenant to access another's data.
2. **Subdomain-per-tenant routing** ? each tenant is accessed via their own FQDN (`tenant1.aldous.info`). The global admin console uses the root domain (`aldous.info`).
3. **Per-tenant SSO** ? each tenant configures and maintains their own identity provider (Google, Microsoft Entra, Okta, SAML, or local credentials). Keycloak brokers external tokens into the platform's standard token.
4. **Per-tenant theming** ? each tenant has their own branded login page and application theme.
5. **Full infrastructure isolation** ? separate database schema, separate cache namespace, separate storage namespace per tenant.

**Current state (gap this ADR closes):**

- Single shared PostgreSQL schema, no Row-Level Security, no schema-per-tenant.
- One Keycloak realm for the entire platform. No per-tenant SSO configuration.
- No subdomain routing. All tenants use the same FQDN.
- No tenant branding or login page theming.
- Application-layer `organisationId` threading is the only isolation mechanism.

## Decision

The platform implements **full-stack per-tenant isolation** across five layers: routing, auth, database, cache, and storage. Each layer independently enforces the tenant boundary.

---

### 1. FQDN-based tenant routing

Each tenant is assigned a subdomain on provisioning:

````text
aldous.info             ? global admin / super-admin console
{slug}.aldous.info      ? tenant application and login
```

The `slug` is the tenant's `organisations.slug` value ? a lowercase alphanumeric identifier chosen at provisioning.

**Caddy routing** ? wildcard subdomain:

```caddy
*.aldous.info, aldous.info {
  @tenant_kc path /kc/*
  @api       path /api/* /auth/* /healthz /readyz /version

  handle @tenant_kc {
    reverse_proxy keycloak:8080
  }

  handle @api {
    reverse_proxy platform-api:3001
  }

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }
}
```

**Tenant resolution in platform-api:**

The BFF reads the `X-Forwarded-Host` request header (set by the external Caddy reverse-proxy to the original client hostname) to determine which tenant is being served, falling back to the `Host` header when the platform is accessed directly. On every request, before session validation:

> **Trust boundary:** `X-Forwarded-Host` is only accepted from the internal network. The external Caddy is the sole entry point; it strips any client-supplied `X-Forwarded-Host` and replaces it with the real client hostname before forwarding. Application code must never be updated to trust `X-Forwarded-Host` from an unauthenticated network boundary.

```typescript
function resolveTenantFromHost(host: string): string | null {
  const subdomain = host.split(".")[0];
  if (subdomain === "aldous" || host === "aldous.info") return null; // global admin
  return subdomain; // e.g. "acme" from "acme.aldous.info"
}
```

The resolved slug is looked up in `public.organisations` to get the `organisationId`. This value is then verified against the session's `organisationId` ? a mismatch (user from tenant A accessing tenant B's FQDN) is a `ForbiddenError`.

**Why FQDN not session:** The FQDN determines which tenant's UI, theme, and Keycloak realm are served to the browser ? before the user is logged in. The session then confirms the user belongs to that tenant.

**Wildcard TLS:** A wildcard certificate (`*.aldous.info`) is provisioned for all subdomains. Let's Encrypt supports wildcard certificates via DNS-01 challenge. Cloudflare handles this for the production deployment.

#### 1a. Path-prefixed operational UI routing

All developer and operational UI services are accessible through Caddy as path-prefixed routes. Access to every tool is gated by `GET /internal/auth/forward` on the BFF ? Caddy's `forward_auth` directive checks the platform session before proxying. This means the platform's Keycloak Authorization Services policy (ADR-0030) governs who can access which tool, and tenant admins can configure access rules within their realm without platform operator involvement.

**Super-global (`aldous.info`) ? system-admin and delegated access:**

| Path | Service | Default access |
|---|---|---|
| `/kc/*` | Keycloak (all realms) | `system-admin` |
| `/mailpit/*` | Mailpit (all tenant email) | `system-admin` |
| `/sonar/*` | SonarQube | `system-admin` |
| `/minio/*` | MinIO console | `system-admin` |
| `/sentry/*` | Sentry | `system-admin` |
| `/wiremock/*` | WireMock admin (dev) | `system-admin` |
| `/clickhouse/*` | ClickHouse HTTP UI | `system-admin` |
| `/localstack/*` | LocalStack (dev/staging) | `system-admin` |

Tilt UI (`:10350`) is NOT path-proxied ? its SPA makes absolute `/api/*` calls that conflict with the platform API path. Access it directly at `http://localhost:10350` during local development.

**Per-tenant (`{slug}.aldous.info`) — tenant-admin access:**

| Path | Service | Filter | Classification |
|---|---|---|---|
| `/kc/*` | Keycloak (tenant realm admin) | Own realm only (OIDC login is realm-scoped) | TENANT_SCOPED_SAFE |
| `/mailpit/*` | Mailpit (tenant email) | Tenant domain emails | TENANT_SCOPED_SAFE |
| `/sentry/*` | Sentry (tenant project) | Tenant project | TENANT_SCOPED_SAFE |

**PGAdmin — GLOBAL_ONLY (never tenant-admin)**

PGAdmin is restricted to system-admin/global operators only and is never exposed to tenant admins.

**Reason:** PGAdmin grants raw SQL access. Row-Level Security (RLS) in PostgreSQL uses the GUC `app.current_tenant_id` to identify the tenant context, but GUCs are user-settable: any connection holder can execute `SET app.current_tenant_id = 'other-org-id'` to bypass RLS and read other tenants' data. Until ADR-ACT-0184 replaces the GUC bypass with a Postgres role-membership check (`pg_has_role(current_user, 'rls_bypass', 'MEMBER')`), tenant-scoped PGAdmin access cannot be proven safe.

**Current enforcement:**

- `TENANT_ADMIN_RESOURCES` in `forward-auth.ts` does not include `admin:pgadmin`.
- `SYSTEM_ADMIN_RESOURCES` includes `admin:pgadmin` — system-admin only.
- Caddy `forward_auth` gate at `/pgadmin/*` uses `resource=admin:pgadmin scope=read`.
- PGAdmin server configuration uses `pgadmin_sysadmin` role (bypasses RLS, sees all tenant data).

**Future:** Tenant-scoped PGAdmin requires ADR-ACT-0184 (role-membership RLS bypass) plus a separate PGAdmin instance or a proven per-tenant role that hard-isolates tenant data. Requires a new ADR amendment before proceeding.

#### 1b. Universal build, data-driven tenants

The React SPA and platform-api are compiled **once** into a single tenant-agnostic build artifact. The build does not contain or require tenant-specific code. At runtime:

- The SPA detects `aldous.info` (super-admin mode) vs `{slug}.aldous.info` (tenant mode) from the hostname
- `GET /api/theme` returns tenant-specific branding (logo, colours, display name) based on the Host header
- The session actor's roles determine which features and admin tools are visible

**Tenant provisioning is a runtime API operation, not a deployment.** Creating a new tenant is `POST /api/admin/tenants` which triggers:
1. PostgreSQL schema creation
2. Keycloak realm provisioning (via Admin API)
3. Redis ACL user creation
4. S3 bucket policy provisioning
5. Initial membership creation

No build, no restart, no deployment. The infrastructure serves the new tenant immediately after the API call completes.

#### 1c. Recursive delegated administration

The provisioning model is hierarchical and recursive:

- `system-admin` at `aldous.info` provisions tenants (creates schemas, Keycloak realms, Redis ACLs, S3 policies).
- `tenant-admin` at `{slug}.aldous.info` provisions within their tenant: groups, sub-organisations, feature modules, user accounts, IdP integrations, and resource policies ? all without system-admin intervention.
- Group admins within a tenant can be granted delegated rights over their group's user management via Keycloak's fine-grained admin permissions.

Each level of admin sees the same dynamic provisioning pattern (data-driven, no deployment) scoped to their authority level. The tenant-admin's provisioning API is `POST /api/admin/*` routes gated by `admin:*` resource policies in their tenant's Keycloak realm, managed by the tenant admin themselves (ADR-0030).

This means the platform admin UI at `aldous.info` and the tenant admin section at `{slug}.aldous.info/admin` are architecturally equivalent ? both provision their respective scope at runtime from the same universal SPA build.

**Does full isolation require separate Compose stacks per tenant?** No. The schema-per-tenant (PostgreSQL) + Redis namespace + S3 prefix model provides complete data isolation within a shared infrastructure stack. Separate stacks are only warranted for regulatory air-gap or geographic data residency requirements ? tracked as future scope in ADR-ACT-0141.

---

### 2. Auth isolation ? per-tenant Keycloak realm

#### 2a. One realm per tenant

Each tenant has its own Keycloak realm:

```text
realms/platform         ? super-admin realm (global admin operations)
realms/tenant-{id}      ? one realm per tenant organisation
```

A Keycloak realm is a completely isolated namespace: its own user store, roles, clients, identity providers, login theme, and session configuration. A user in `realms/tenant-acme` cannot authenticate against `realms/tenant-other`.

The super-admin realm (`platform`) contains only `system-admin` users. It does not contain tenant users.

#### 2b. Identity brokering ? per-tenant SSO

Each tenant realm is configured with one or more **identity providers** (IdPs) that Keycloak brokers:

| Protocol            | Examples                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local credentials   | Username/password in the tenant's own Keycloak realm user store. Self-service registration, password reset, MFA, and email verification are all configurable per tenant. No external IdP required. |
| OIDC                | Google, Microsoft Entra (Azure AD), Okta, Auth0, any OpenID Connect IdP                                                                                                                            |
| SAML 2.0            | Corporate SAML providers, on-premises AD FS                                                                                                                                                        |
| Cross-tenant broker | Another tenant's Keycloak realm (see ?2e)                                                                                                                                                          |

**Local accounts are a first-class option**, not a fallback. Tenants without a corporate identity provider manage their users directly in their realm. The tenant admin creates users, sets password policies, enables MFA, and manages account lifecycle ? all through the Keycloak admin console for their realm at `{slug}.aldous.info/kc/admin/tenant-{id}/console`. The platform does not need to be involved in day-to-day user management for local-account tenants.

**Brokering flow:**

```text
Browser ? /kc/realms/tenant-{id}/protocol/openid-connect/auth
        ? Keycloak login page (tenant-branded)
        ? [User selects their IdP, or enters local credentials]
        ? External IdP authenticates user, returns token to Keycloak
        ? Keycloak maps claims (sub, email, groups) ? Keycloak user model
        ? Keycloak issues access_token to platform-api BFF client
        ? BFF exchanges code for token (PKCE)
        ? BFF creates session, sets HTTP-only cookie
        ? User lands on tenant application
```

Keycloak brokered tokens contain the platform's standard claims (`sub`, `email`, `realm_access.roles`, `organisationId` attribute) regardless of which upstream IdP authenticated the user. The BFF and the rest of the platform never see the upstream IdP token.

**Tenant manages their own SSO:** Each tenant's realm can be reconfigured (add/remove IdPs, change login flows, update claim mappings) without affecting other tenants. The platform Terraform module provisions the realm and the BFF client; the tenant manages IdP configuration via the Keycloak admin console for their own realm.

#### 2c. BFF client per realm

Each tenant realm has a confidential BFF client:

- Client ID: `platform-api` (consistent across realms)
- Client secret: unique per realm, stored in the platform's secret store
- Redirect URI: `https://{slug}.aldous.info/auth/callback`
- Post-login redirect: `https://{slug}.aldous.info/`

The BFF resolves which client secret to use based on the tenant resolved from the Host header.

#### 2d. Tenant selection at login

When the browser hits `{slug}.aldous.info/auth/login`, the BFF:

1. Resolves the slug ? `organisationId` ? Keycloak realm name (`tenant-{id}`)
2. Constructs the Keycloak authorization URL for that realm
3. Redirects the browser to the tenant's Keycloak login page

The user never sees a "which organisation are you?" selector. The FQDN they navigated to determines their realm.

#### 2e. Cross-tenant identity brokering

Tenants may grant access to users from other tenants based on their own configured rules. This is implemented via Keycloak cross-realm OIDC federation:

```text
User at acme.aldous.info ? chooses "Login with partner.aldous.info"
  ? acme realm redirects to partner realm (configured as an IdP in acme's realm)
  ? partner realm authenticates the user against their own IdP (their Google, Entra, etc.)
  ? partner realm issues a token to acme realm
  ? acme realm brokers: maps partner user claims ? acme realm user model
  ? acme realm issues access_token to the BFF
  ? BFF creates session; user has a Membership in acme's tenant schema
```

**Tenant controls their own trust rules:**

The tenant (`acme`) configures which other tenant realms it trusts as identity providers via the Keycloak admin console for their own realm. The platform does not mediate or approve cross-tenant trust relationships ? this is fully within the tenant admin's control.

**Broker-sourced users get a Membership:**

When a broker-sourced user logs in for the first time to a tenant that is not their home tenant:

1. The BFF receives the brokered token. The `sub` claim is prefixed with the source realm: `broker:{source-realm}:{original-sub}`.
2. A `users` record is created in `public.users` (if not existing) with the brokered email.
3. An `ExternalIdentity` is created linking the source realm's subject to the platform user.
4. The platform looks up the user's `Membership` in the target tenant schema. If none exists, the login is rejected with an `UnauthorizedError` ? the tenant admin must pre-provision the cross-tenant membership before a broker-sourced user can access.
5. If a Membership exists, the session is created with the role assigned in that Membership.

**No implicit access:** A user brokering from tenant A is not automatically a member of tenant B. Tenant B's admin must explicitly create the Membership (with the desired role) before the cross-tenant login succeeds. This ensures the tenant fully controls who enters their namespace.

**Data isolation is unchanged:** A broker-sourced user accessing tenant B operates entirely within tenant B's schema, cache namespace, and storage prefix. They have no visibility into tenant A's data via the cross-tenant session.

#### 2f. Session isolation

Session cookies are scoped to the tenant's subdomain:

```text
Set-Cookie: platform_session={id}; Domain=.{slug}.aldous.info; HttpOnly; SameSite=Strict; Secure
```

A session cookie issued for `acme.aldous.info` is not sent to `other.aldous.info`. The BFF enforces that the session's `organisationId` matches the tenant resolved from the Host header on every authenticated request.

---

### 3. Database isolation ? schema-per-tenant + RLS

#### 3a. Schema naming

On tenant provisioning, a schema is created:

```sql
CREATE SCHEMA "tenant_{organisationId_underscored}";
```

All business data for that tenant lives in this schema. The `public` schema holds only cross-tenant identity tables: `users`, `external_identities`, `organisations`.

#### 3b. Transaction-scoped schema context

The adapter layer sets `search_path` at the start of every transaction:

```typescript
async function withTenant<T>(
  pool: pg.Pool,
  organisationId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const schema = `"tenant_${organisationId.replaceAll("-", "_")}"`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

`SET LOCAL` scopes `search_path` to the transaction only ? pool-safe.

#### 3c. Row-Level Security (defence in depth)

Within each tenant schema, RLS enforces user-level access control (a member cannot read another member's private records):

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY user_scope ON <table>
  USING (
    user_id = current_setting('app.current_user_id')::uuid
    OR current_setting('app.bypass_rls', true)::boolean IS TRUE
  );
```

Schema isolation prevents cross-tenant access. RLS within the schema provides the second line of defence for per-user data.

#### 3d. System-admin cross-tenant access

```typescript
async function withSystemAdmin<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.bypass_rls = true");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

Every `withSystemAdmin` call must emit an audit event. Cross-tenant queries qualify the schema explicitly: `"tenant_{id}".table_name`.

#### 3e. Per-tenant migration runner

On deployment, each tenant schema receives the latest migrations independently:

```typescript
async function migrateAllTenants(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM public.organisations WHERE suspended_at IS NULL"
  );
  await Promise.allSettled(rows.map(({ id }) => migrateTenantSchema(pool, id)));
}
```

Migrations are idempotent. A failure in one tenant schema does not affect others.

---

### 4. Extended auth capabilities

The per-tenant Keycloak realm model is designed for maximum flexibility. The following auth behaviours are supported out of the box by the Keycloak-per-realm architecture ? all are tenant-configurable without platform code changes:

#### 4a. Multi-factor authentication (MFA)

Each tenant configures their own MFA policy via the Keycloak admin console:

- TOTP (Google Authenticator, Authy)
- WebAuthn / FIDO2 (hardware keys, passkeys)
- SMS OTP (via Keycloak SMS provider extensions)
- Email OTP
- MFA can be required for all users, only for specific roles (e.g., `tenant-admin`), or optional

The platform does not enforce a global MFA policy ? this is a per-tenant security decision.

#### 4b. Passwordless login

Tenants can enable passwordless flows:

- **Magic link** (email-based): Keycloak sends a one-time login URL
- **WebAuthn passkey**: browser-native biometric authentication
- **Social login without password**: if the tenant uses Google or Entra SSO, users never need a platform password

#### 4c. Session policies per tenant

Each realm independently configures:

- Access token lifetime (default 15 min; tenant can extend/shorten)
- SSO session idle timeout (default 30 min)
- SSO session max lifespan (default 10 hr)
- Remember-me (can be enabled per realm if the tenant allows it)
- Concurrent session limits

#### 4d. Adaptive authentication

Keycloak supports conditional authentication flows. Tenants can configure policies such as:

- Require MFA if logging in from an unrecognised IP or device
- Require MFA for `tenant-admin` role only
- Block logins from specific IP ranges (via Keycloak IP-based condition)
- Step-up authentication for sensitive operations (re-authentication before accessing admin sections)

These flows are configured per realm via Keycloak's Authentication Flow builder.

#### 4e. Group-based role assignment

Tenants can mirror their IdP's groups to Keycloak roles via claim mappers:

```text
External IdP group "platform-admins" ? Keycloak realm role "tenant-admin"
External IdP group "readonly-users"  ? Keycloak realm role "viewer"
```

This means the tenant does not need to manage individual user roles in the platform ? role assignment flows from their corporate directory.

#### 4f. Account self-service

For local-account tenants, Keycloak provides:

- Self-service password reset (email-based)
- Self-service account profile management (`/kc/realms/tenant-{id}/account`)
- Email verification on registration
- Account linking (connect additional IdPs to an existing account)

The platform BFF session is unaffected by account self-service ? it uses the realm's token endpoint. Self-service operations go directly to Keycloak and do not pass through the BFF.

#### 4g. Just-in-time (JIT) user provisioning

When a user authenticates via an external IdP for the first time, Keycloak automatically creates a local user record in the realm (JIT provisioning). The platform then creates an `ExternalIdentity` record mapping the Keycloak user to the platform `User`. A `Membership` record must exist (pre-provisioned by the tenant admin) before the session is created ? login without a Membership is rejected.

JIT provisioning means the tenant admin does not need to pre-create user accounts in Keycloak; they only need to pre-create Memberships in the platform.

#### 4h. Vanity domains (future)

Tenants may want a fully custom domain (e.g., `app.acmecorp.com` instead of `acme.aldous.info`). The architecture supports this via:

- DNS CNAME from `app.acmecorp.com` ? `acme.aldous.info`
- Caddy SNI-based virtual host matching the custom domain
- TLS certificate provisioned via Let's Encrypt HTTP-01 (no wildcard needed for custom domain)
- The platform resolves the tenant from the custom domain via the `organisations.custom_domain` column

Custom domain support is tracked separately and is not part of the initial delivery.

---

### 5. Per-tenant theming

Each tenant can configure:

- **Login page theme** ? Keycloak supports custom themes per realm. A base theme is provided by the platform; tenants can override colours, logo, and background via the Keycloak admin console.
- **Application theme** ? The React SPA reads a `GET /api/theme` endpoint that returns the tenant's configured colour scheme, logo URL, and display name. The app applies these at load time before rendering.
- **Email templates** ? Keycloak transactional emails (password reset, email verification) use the tenant's realm theme.

**Theme resolution flow:**

```text
Browser loads {slug}.aldous.info
  ? React SPA fetches /api/theme (unauthenticated endpoint, keyed by Host header)
  ? Returns { primaryColour, logoUrl, displayName, faviconUrl }
  ? SPA applies CSS variables and renders tenant branding
  ? Login page is Keycloak's themed realm login (also keyed to the realm)
```

Theme configuration is stored in the tenant schema as a `tenant_settings` table row, returned by the `GET /api/theme` endpoint without requiring authentication.

---

### 6. Cache isolation ? Redis

#### Per-tenant key namespace and ACL

Every tenant-scoped Redis key uses the prefix `t:{organisationId}:`:

```text
t:{organisationId}:perm:{userId}       ? resolved permissions cache
t:{organisationId}:profile             ? org profile cache
t:{organisationId}:theme               ? theme config cache
```

Sessions are keyed by opaque `sessionId` ? the tenant is inside the session value, not the key.

In production, each tenant has a Redis ACL user restricted to their key prefix:

```text
ACL SETUSER t_{id} on >{password} ~t:{id}:* +@read +@write +@string +@hash
```

Application code uses the tenant ACL user for tenant-scoped operations and the platform service user for session operations. Redis rejects cross-prefix key access at the engine level.

---

### 7. Object storage isolation ? S3 / MinIO

Every tenant's objects are stored under `{organisationId}/`:

```text
{organisationId}/{feature}/{filename}
```

`S3ObjectStorageAdapter` validates the prefix on every write and read. In production, a per-tenant IAM user or bucket policy restricts access to the tenant's prefix at the AWS/MinIO level. Presigned URLs are scoped to the tenant's prefix ? they cannot be used to access another tenant's objects.

---

### 8. Analytics isolation ? ClickHouse

Every analytics table has a required `tenant_id UUID NOT NULL` column. Tables are partitioned by `tenant_id` for efficient deletion. The `ClickHouseAnalyticsAdapter` enforces `tenantId` as a required query parameter. Cross-tenant analytics (billing, platform health) use a separate read-only reporting user with explicit cross-tenant access.

---

### 9. Tenant lifecycle

#### Provisioning

1. `system-admin` triggers tenant creation (via admin console at `aldous.info`).
2. Organisation record created in `public.organisations` with slug and FQDN.
3. Keycloak realm created: `tenant-{id}` with base theme and BFF client.
4. PostgreSQL schema created: `tenant_{id}` with all current migrations applied.
5. Redis ACL user provisioned.
6. S3 bucket policy for `{organisationId}/` prefix provisioned.
7. Initial `tenant-admin` membership created.
8. Provisioning emits audit event. Tenant FQDN goes live.

#### SSO configuration

After provisioning, the tenant admin accesses `{slug}.aldous.info/kc/admin` to configure their identity provider. The platform provides:

- Keycloak admin credentials scoped to their realm only (a realm admin role, not a server admin)
- Documentation for connecting Google, Entra, Okta, and SAML providers
- A test login flow to verify the IdP integration before enabling it for users

#### Suspension

All user sessions for the tenant are invalidated. Keycloak realm is disabled (no new logins accepted). Data and schema remain intact.

#### Hard deletion

1. All active sessions invalidated.
2. Keycloak realm deleted: `DELETE /realms/tenant-{id}`.
3. PostgreSQL schema dropped: `DROP SCHEMA "tenant_{id}" CASCADE`.
4. S3 objects deleted under `{organisationId}/` prefix.
5. Redis keys flushed matching `t:{organisationId}:*`.
6. Redis ACL user revoked.
7. S3 bucket policy removed.
8. ClickHouse rows deleted by `tenant_id`.
9. `public.organisations` row deleted.
10. All steps audited in the platform audit log before schema drop.

---

### 10. Invariants ? never violate without ADR amendment

1. **Tenant is determined from FQDN.** The BFF reads `X-Forwarded-Host` (Caddy-set, trusted internal header) with `Host` as fallback. `organisationId` is never accepted from the request body as the tenant selector.

2. **Session is verified against FQDN tenant.** A session issued for tenant A is rejected when presented on tenant B's FQDN. Mismatch = `ForbiddenError`.

3. **All tenant data in `tenant_{id}` schema.** No tenant business table in `public`. `public` holds cross-tenant identity records only.

4. **Every repository method uses `withTenant`.** Direct pool access on tenant tables is an architecture violation.

5. **`withSystemAdmin` is audited.** Every call emits an audit event before executing.

6. **Redis keys use `t:{organisationId}:` prefix.** Production Redis ACLs enforce this at the engine level.

7. **S3 keys are `{organisationId}/`-prefixed.** Adapter validates; production bucket policies enforce.

8. **ClickHouse queries include `tenant_id`.** Adapter interface requires it as a mandatory parameter.

9. **Keycloak brokered tokens are the auth source.** The platform never verifies upstream IdP tokens directly. All auth flows go through the tenant's Keycloak realm.

10. **Tenant admins manage only their own realm.** A realm-admin Keycloak role scoped to `realms/tenant-{id}` is granted to the tenant admin. No server-admin role is granted to tenants.

---

## Rationale

**Schema-per-tenant** is chosen for database isolation because:

- Physical data separation is required ? not just logical (RLS-only).
- `DROP SCHEMA CASCADE` provides atomic, complete tenant deletion.
- Schema isolation combined with RLS provides two independent isolation layers.
- Operationally simpler than database-per-tenant (no per-tenant connection pools).

**Per-tenant Keycloak realm** is chosen because:

- Each tenant needs independent SSO configuration (their own IdP, login flow, MFA policy).
- Realm-level isolation means a compromise of one tenant's realm does not expose others.
- Keycloak login page theming is per-realm ? no shared login page.
- Identity brokering (federated tokens from corporate IdPs) is a standard Keycloak feature per realm.

**FQDN-based tenant selection** is chosen because:

- The tenant is determined before the user is logged in (needed for login page theme).
- Subdomain routing is a familiar enterprise pattern (Slack, Notion, GitHub Enterprise).
- Session cookie scoping to subdomain provides an additional isolation boundary.

## Consequences

**Positive:**

- No cross-tenant data breach possible from application code omission.
- Each tenant has fully independent auth, data, cache, and storage.
- Tenants control their own SSO without platform involvement.
- FQDN routing supports enterprise vanity domains in future (CNAME to `{slug}.aldous.info`).
- Full tenant offboarding is atomic and complete.

**Negative:**

- Keycloak realm provisioning adds steps to tenant creation (automated via Terraform/Keycloak admin API).
- Schema migrations run per tenant on deploy (parallelised, idempotent).
- BFF must manage N Keycloak client secrets (one per tenant realm) ? requires a secret store (e.g., AWS Secrets Manager or Vault).
- Wildcard TLS certificate required; DNS-01 ACME challenge needed for Let's Encrypt.

**Operational:**

- Keycloak secret rotation per tenant is independent ? no shared secret.
- PgBouncer must be in `transaction` pooling mode.
- Application database role must not be a PostgreSQL superuser.

## Migration path from current state

1. Add FQDN column to `organisations` table. Add slug ? FQDN mapping.
2. Implement Host-header tenant resolution in the BFF pipeline.
3. Implement `withTenant` helper in `packages/adapters-postgres`. Migrate all repository methods.
4. Create a migration script to extract existing data into `tenant_{id}` schemas.
5. Provision a Keycloak realm per existing organisation.
6. Configure the current fixture users in their tenant realms.
7. Implement per-tenant Keycloak client secret resolution in the BFF.
8. Implement `GET /api/theme` endpoint.
9. Implement React SPA theme resolution at load time.
10. Provision Redis ACLs and S3 bucket policies for existing tenants via Terraform.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting, options analysis, architecture recommendation
- Human review status: Reviewed by architecture owner

## Validation / evidence

Evidence level: Decision ? implementation evidence tracked in ACTION-REGISTER.

## Impacted areas

- Routing: Caddy wildcard subdomain; wildcard TLS certificate
- Auth: Keycloak realm per tenant; identity brokering; realm-scoped tenant admin
- Database: schema-per-tenant; per-tenant migration runner; RLS within schema
- Cache: Redis ACL per tenant; `t:{id}:` key prefix enforcement
- Storage: `{organisationId}/` prefix enforcement; S3 bucket policy per tenant
- Analytics: `tenant_id` column; partition-by-tenant; ClickHouse query enforcement
- React SPA: `GET /api/theme` endpoint; CSS variable application at load time
- Secret management: per-tenant Keycloak client secret; secret store required
- Terraform: Keycloak realm module; Redis ACL module; S3 bucket policy module

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-29

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0014: Transactional data ownership
- ADR-0020: RuntimeContext
- ADR-0021: Identity, tenancy, roles, permissions
- ADR-0022: Authentication, session, SSO boundary
- PostgreSQL schema isolation: [ddl-schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- PostgreSQL RLS: [ddl-rowsecurity](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- Keycloak Identity Brokering: [server_admin identity_broker](https://www.keycloak.org/docs/latest/server_admin/#_identity_broker)
- Keycloak Realm Themes: [server_development themes](https://www.keycloak.org/docs/latest/server_development/#_themes)
- Redis ACL: [redis.io/acl](https://redis.io/docs/management/security/acl/)
- OWASP Insecure Direct Object Reference: [owasp.org](https://owasp.org/www-project-web-security-testing-guide/)
````
