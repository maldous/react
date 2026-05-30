# ADR-0031: Define infrastructure provisioning privilege model

## Status

Accepted

## Date

2026-05-29

## Decision owner

Architecture owner / technical lead

## Consulted

- ADR-0029 (multi-tenant isolation boundaries)
- ADR-0030 (dynamic authorisation and tenant admin self-service)
- ADR-0023 (declarative infrastructure provisioning model)

## Context

ADR-0029 ?1c defines a recursive delegated administration model: `system-admin` provisions tenants, `tenant-admin` provisions sub-organisations within their scope, with no human sysadmin intervention required for recursive operations.

The question this ADR answers: **does recursive provisioning require global sysadmin action for infrastructure resource creation, particularly for isolation-critical resources such as PostgreSQL schemas, Keycloak realms, Redis ACL users, and S3 bucket policies?**

The answer has direct security and operational consequences:

- If yes: every sub-tenant creation is a support ticket to a human sysadmin. Recursive delegation breaks down.
- If no: the platform must hold privileged service account credentials capable of acting on behalf of any provisioning request. These credentials must be tightly controlled.

## Privilege analysis by resource type

| Resource          | Operation                               | Privilege required               | Platform application user has it?           |
| ----------------- | --------------------------------------- | -------------------------------- | ------------------------------------------- |
| PostgreSQL schema | `CREATE SCHEMA "tenant_{id}"`           | Database owner or `CREATE` grant | **Yes** ? `platform` user owns the database |
| Keycloak realm    | `POST /admin/realms`                    | Master realm admin               | **No** ? holds only BFF client secret       |
| Redis ACL user    | `ACL SETUSER tenant_{id}`               | Redis admin user                 | **No** ? single application connection      |
| S3 / MinIO policy | `PutBucketPolicy` / MinIO admin         | IAM admin or root credentials    | **No** ? per-tenant credentials only        |
| Sub-org data      | `INSERT`, `SELECT` within tenant schema | Normal DB user + `search_path`   | **Yes** ? within `withTenant()` context     |

### PostgreSQL: no additional privilege required

The `platform` PostgreSQL user is the database owner (created via `POSTGRES_USER=platform`, `POSTGRES_DB=platform`). As owner of the `platform` database, it can execute `CREATE SCHEMA` without superuser rights. The application's normal runtime connection is sufficient for schema provisioning.

```sql
-- Executed by platform-api withSystemAdmin() on behalf of provisioning
CREATE SCHEMA "tenant_{organisationId_underscored}";
GRANT USAGE ON SCHEMA "tenant_{id}" TO platform;  -- own user = already granted
```

**Conclusion: PostgreSQL schema creation does not require human sysadmin action.**

### Keycloak realm: provisioning service account required

Keycloak realm creation requires the master realm admin API (`POST /admin/realms`). The platform-api's current runtime credential (BFF client secret) is scoped to a single realm and cannot create realms.

A dedicated **`platform-provisioner`** service account must be created in Keycloak's master realm with the minimum required grant:

```text
Role: manage-realm  (within master realm client)
Scope: create/delete realms only ? NOT server-admin, NOT manage-users on master
```

This service account's client credentials are stored in the platform's secret store (e.g., `platform/keycloak/provisioner-client-secret`) and loaded by platform-api at startup, separate from the runtime BFF client secret. The provisioner credentials are never exposed to tenant-admins or end users.

**Conclusion: Keycloak realm creation requires a provisioning service account, held by the platform ? no human sysadmin needed per-tenant.**

### Redis ACL: admin connection required

Creating Redis ACL users (`ACL SETUSER`) requires a Redis connection with the `+acl` command permission (or an unrestricted admin connection). The application's single runtime Redis connection should not hold this privilege.

A dedicated **Redis admin connection** is used exclusively by the provisioning path:

```typescript
// Separate from createRedisClient() used for sessions/cache
export function createRedisAdminClient(url: string): RedisClientType {
  // Connects as the Redis admin user (NOPASS or with admin credentials)
  return createClient({ url, username: "platform-admin", password: ... });
}
```

The Redis admin credentials are stored in the secret store and loaded by platform-api's provisioning module only. The runtime application connection uses a restricted user without `+acl`.

**Conclusion: Redis ACL user creation requires an admin connection, held by the platform ? no human sysadmin needed per-tenant.**

### S3 / MinIO: admin credentials required

Creating per-tenant IAM users and bucket policies requires the MinIO root credentials or an IAM-admin IAM user. The application's per-tenant S3 adapter uses per-tenant credentials with limited scope.

A dedicated **S3 admin connection** is used exclusively by the provisioning path:

```typescript
// Separate from S3ObjectStorageAdapter used for application data
export function createS3ProvisioningClient(config: S3AdminConfig): S3AdminClient;
```

The S3 admin credentials are stored in the secret store. Per-tenant credentials (created by provisioning) are stored separately per-tenant.

**Conclusion: S3 bucket policy creation requires admin credentials, held by the platform ? no human sysadmin needed per-tenant.**

---

## Decision

**Recursive provisioning does NOT require human sysadmin action for infrastructure resource creation.** The platform acts as a trusted provisioning broker:

1. Privileged service accounts for each infrastructure type are held by the platform (secret store).
2. The provisioning API (`POST /api/admin/tenants`, `POST /api/admin/sub-tenants`) validates the caller's authority via Keycloak Authorization Services (ADR-0030), then executes infrastructure operations using these service accounts.
3. No infrastructure credentials are exposed to tenant-admins, end users, or request contexts.
4. The human sysadmin is responsible for: (a) initial platform deployment, (b) service account credential provisioning, (c) secret rotation, and (d) capacity/quota policy changes.

### Provisioning credential architecture

```text
Secret store (AWS Secrets Manager / Vault / env)
  platform/postgres/connection-url           ? runtime app DB (withTenant/withSystemAdmin)
  platform/keycloak/bff-client-secret        ? BFF OAuth client
  platform/keycloak/provisioner-client-id    ? realm creation service account
  platform/keycloak/provisioner-client-secret ? realm creation service account
  platform/redis/app-url                     ? runtime session/cache connection
  platform/redis/admin-url                   ? ACL user management connection
  platform/s3/app-credentials                ? runtime per-tenant object storage
  platform/s3/admin-credentials              ? IAM user and policy creation
```

Each secret is loaded by the relevant platform-api module at startup. Provisioning secrets are never loaded into request contexts ? they are used only by the provisioning service functions.

### Recursive delegation without sysadmin intervention

When `tenant-admin` provisions a sub-organisation (ADR-ACT-0143):

1. `tenant-admin` calls `POST /api/admin/sub-tenants` on their tenant FQDN.
2. Platform-api verifies `admin:sub-tenants:write` resource permission via Keycloak UMA (ADR-0030). This resource policy is configured by the tenant-admin themselves (or delegated from sysadmin on tenant creation).
3. If authorised, platform-api uses its provisioning service accounts to create:
   - PostgreSQL sub-schema within the parent tenant's schema context (using `withSystemAdmin()` + schema creation)
   - Keycloak realm (if Tier 1 isolation is requested) OR Keycloak group within parent realm (if Tier 2)
   - Redis ACL namespace extension OR new ACL user (if Tier 1)
   - S3 prefix policy extension OR new IAM user with limited prefix (if Tier 1)
4. No human sysadmin is notified or required to action.

### Two-tier isolation model

| Tier                          | Isolation mechanism                                     | Provisioning actor                                                 | Human sysadmin needed?                     |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| **Tier 1** (top-level tenant) | Separate schema, realm, Redis ACL, S3 policy            | Platform provisioning service (on behalf of sysadmin API call)     | No ? platform holds service account        |
| **Tier 2** (sub-organisation) | Logical isolation within parent schema; Keycloak groups | Platform provisioning service (on behalf of tenant-admin API call) | No ? same service accounts, narrower scope |

Sub-organisations at Tier 2 share the parent tenant's physical infrastructure (schema, realm, Redis namespace). Additional row-level or group-level scoping provides logical isolation. If a sub-org requires Tier 1 isolation (own schema, own realm), the platform can provision it ? but this must be explicitly requested and may require quota approval.

### Quota and capacity governance

The one area where human sysadmin involvement remains appropriate is **capacity planning and quota management**:

- Maximum number of tenants (platform-wide) ? configured by sysadmin
- Maximum sub-organisations per tenant ? configured by sysadmin on tenant creation, editable by sysadmin later
- Storage quotas, compute limits ? sysadmin-configurable policies stored in `public.platform_config`

Quota enforcement is automated. A provisioning request that would exceed a quota returns `429 Too Many Resources` without sysadmin notification. Changing quotas requires sysadmin action ? but day-to-day provisioning within quota does not.

---

## Invariants

1. **Provisioning service accounts are never exposed outside the platform-api process.** They are loaded from the secret store at startup and used only within provisioning functions. They must not appear in logs, request responses, session tokens, or audit records.

2. **All provisioning operations are audited.** Every infrastructure resource created or destroyed is recorded in the platform audit log (actor, operation, resource identifiers, timestamp). This is enforced before the infrastructure call executes.

3. **Provisioning is idempotent.** A repeated provisioning call for the same sub-org must succeed without creating duplicate infrastructure. `CREATE SCHEMA IF NOT EXISTS`, Keycloak's conflict-safe realm creation, Redis ACL's `SETUSER ... RESET` pattern, and S3 policy `PutBucketPolicy` are all idempotent.

4. **Failure isolation.** A failed sub-component of provisioning (e.g., Redis ACL fails after schema created) must trigger a rollback or compensating action. Partial provisioning must not leave a sub-org in an inconsistent state.

5. **Human sysadmin is the only actor who can change quotas or credential rotation schedules.** This prevents tenant-admins from self-escalating their resource limits.

---

## Rationale

**Why not require human sysadmin per sub-tenant?**

Recursive delegation (ADR-0029 ?1c) requires that tenant-admins can provision within their scope without platform operator intervention. If every sub-tenant requires a support ticket, recursive delegation is nominal ? not real. The platform-as-broker pattern resolves this without compromising security.

**Why not give tenant-admins the provisioning credentials?**

Giving tenant-admins infrastructure admin credentials would break the isolation model ? a compromised tenant-admin could use the credentials to access other tenants' infrastructure. The platform-as-broker model means tenant-admins only have authority to call the provisioning API, not the underlying infrastructure.

**Why not use PostgreSQL superuser for schema creation?**

The `platform` database owner can already `CREATE SCHEMA`. Using a superuser would be over-privileged (superuser bypasses all security checks including RLS). The existing database owner privilege is sufficient and safer.

### Provider-agnostic provisioning (ISO 27001 / multi-cloud extensibility)

The single-instance (shared cluster, same host) model described above is the **default and minimum viable configuration**. It is not the only option. The provisioning service account model is designed to be provider-agnostic and extensible.

**Infrastructure tiers available per tenant (system-admin configurable):**

| Tier                  | Database                            | Identity                       | Cache                     | Storage                    | Typical use                       |
| --------------------- | ----------------------------------- | ------------------------------ | ------------------------- | -------------------------- | --------------------------------- |
| **Shared** (default)  | Schema in shared cluster            | Realm in shared Keycloak       | Namespace in shared Redis | Prefix in shared bucket    | Standard tenants                  |
| **Dedicated cluster** | Own PostgreSQL instance             | Own Keycloak instance          | Own Redis instance        | Own S3 bucket              | High-isolation tenants            |
| **Separate cloud**    | RDS/Cloud SQL on different provider | Keycloak on tenant's own cloud | ElastiCache/Memorystore   | Tenant's own cloud storage | Regulatory data residency         |
| **Air-gapped**        | Tenant-managed infra                | Tenant-managed IdP             | Tenant-managed            | Tenant-managed             | HIPAA, FedRAMP, ISO 27001 Annex A |

The `RealmProvisioningPort`, `RedisProvisioningAdapter`, and `S3ProvisioningAdapter` are **port/adapter pairs** ? the platform defines the interface; the adapter targets a specific infrastructure provider. Swapping from shared PostgreSQL to a dedicated RDS instance for a tenant requires:

1. A new `RdsProvisioningAdapter` that implements the same `createTenantSchema` contract but connects to a different endpoint.
2. System-admin configures the tenant's `provisioning_tier` in `public.platform_config`.
3. The provisioning service selects the correct adapter at runtime based on tier.

No code change to the provisioning API surface ? only a new adapter and a data configuration change.

**Per-resource deployment requirements** are supported through this adapter pattern: each infrastructure resource (database, identity, cache, storage, compute) can independently target a different provider or deployment target. A tenant could have their database on AWS RDS, their identity on Azure Entra (via SAML broker), their storage on GCS, and their cache on a shared cluster ? each managed through the appropriate provisioning adapter, all coordinated by the platform provisioning service from a single API call.

The system-admin console at `aldous.info/admin` exposes tenant infrastructure tier selection as a runtime configuration decision, not a deployment decision.

## Consequences

**Positive:**

- Recursive tenant/sub-tenant provisioning is fully self-service for authorised principals.
- No human sysadmin bottleneck for normal growth of tenant or sub-organisation count.
- Provisioning credentials are centralised in the secret store ? rotation is managed in one place.
- Audit trail covers all infrastructure operations regardless of who triggered them.
- Infrastructure tier is a data-driven, runtime decision ? tenants can be migrated between tiers without code deployment.
- New infrastructure providers are added as adapter packages, not platform code changes.

**Negative:**

- Platform-api must load and securely hold provisioning credentials at startup ? adds startup validation requirement (fail fast if any provisioning credential is missing).
- Provisioning code path is more complex than runtime code (multiple service accounts, rollback logic).
- The provisioning service accounts represent a high-privilege attack surface ? they must be isolated to the provisioning module, not available to request handlers.

**Operational:**

- Credential rotation must be coordinated (secret store update ? platform-api restart or live reload).
- Quota configuration is sysadmin territory ? changes require deliberate access to `public.platform_config`.
- The Redis admin connection should use a dedicated Redis user created at cluster initialisation, not the default `requirepass` credential shared with application traffic.

## AI-assistance record

AI used: Yes

- Tool/model: Claude Sonnet 4.6
- Assistance scope: ADR drafting and privilege analysis
- Human review status: Reviewed by architecture owner

## Validation / evidence

Evidence level: Decision ? implementation tracked in ACTION-REGISTER.

## Impacted areas

- `apps/platform-api/src/server/dependencies.ts`: add provisioning credential loading (separate from runtime credentials)
- New: `apps/platform-api/src/server/provisioning.ts`: tenant and sub-tenant provisioning service
- `packages/adapters-keycloak`: add `KeycloakProvisioningAdapter` (master realm operations)
- `packages/adapters-redis`: add `createRedisAdminClient` (ACL management)
- `packages/adapters-object-storage`: add `S3ProvisioningAdapter` (IAM operations)
- Secret store: provision service account credentials as part of platform deployment
- Quota model: `public.platform_config` table for platform-wide limits

## Follow-up actions

Follow-up actions tracked in `docs/adr/ACTION-REGISTER.md`.

## Review date

2026-08-29

## Supersedes

None. Extends ADR-0029 (isolation boundaries) and ADR-0030 (dynamic authorisation).

## Superseded by

None.

## References

- ADR-0023: Declarative infrastructure provisioning model
- ADR-0029: Multi-tenant isolation boundaries
- ADR-0030: Dynamic authorisation and tenant admin self-service
- PostgreSQL database ownership: [postgresql.org/ddl-schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- Keycloak master realm admin: [keycloak.org/server_admin realm-admin](https://www.keycloak.org/docs/latest/server_admin/#realm_admin)
- Redis ACL: [redis.io/acl](https://redis.io/docs/management/security/acl/)
