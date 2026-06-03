/**
 * Tenant provisioning service ? ADR-ACT-0142, ADR-0031
 *
 * Orchestrates per-resource infrastructure provisioning for a new tenant.
 * Each resource type (database, identity, cache, storage) dispatches to the
 * correct adapter based on the requested tier. Tiers are independent ? a
 * tenant can mix shared database with dedicated storage, etc.
 *
 * Security: uses provisioning service accounts from ProvisioningConfig,
 * never exposes them to request handlers or tenants. ADR-0031.
 *
 * Idempotency: each step checks existence before creating. Safe to retry.
 *
 * Rollback: on failure after partial provisioning, cleanup is attempted per
 * resource. Partial state is logged ? operator can complete cleanup manually.
 */

import crypto from "node:crypto";
import pg from "pg";
import { z } from "zod";
import {
  createTenantSchema,
  withSystemAdmin,
  tenantSchemaIdentifier,
} from "@platform/adapters-postgres";
import { KeycloakProvisioningAdapter } from "@platform/adapters-keycloak";
import { createRedisAdminClient, RedisProvisioningAdapter } from "@platform/adapters-redis";
import { S3ProvisioningAdapter } from "@platform/adapters-object-storage";
import {
  mergeResourceConfig,
  type TenantResourceConfig,
  type DatabaseResourceConfig,
  type IdentityResourceConfig,
  type CacheResourceConfig,
  type StorageResourceConfig,
} from "@platform/authorisation-runtime";
import { createLogger } from "@platform/platform-logging";
import { ConflictError } from "@platform/platform-errors";
import {
  createAuditEvent,
  createPostgresAuditEventPort,
  AuditAction,
  type AuditEventPort,
} from "@platform/audit-events";
import { isSlugReserved } from "@platform/domain-identity";
import { getApplicationPool, getProvisioningConfig } from "./dependencies.ts";
import { PostgresTenantCredentialStore } from "../adapters/postgres-tenant-credential-store.ts";

const log = createLogger({ name: "provisioning" });

// Audit port — PostgreSQL-backed (ADR-ACT-0148 satisfied).
// Lazy reference to the pool so the adapter is constructed after app startup.
function getAuditPort(): AuditEventPort {
  return createPostgresAuditEventPort(getApplicationPool());
}

// ---------------------------------------------------------------------------
// Request schema (zod) ? validated at the route handler before calling here
// ---------------------------------------------------------------------------

const ResourceTierSchema = z.enum(["shared", "dedicated", "external", "air-gapped"]);

export const CreateTenantRequestSchema = z.object({
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(63, "Slug must be at most 63 characters")
    .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, digits, and hyphens")
    .refine(
      (s) => !s.startsWith("-") && !s.endsWith("-"),
      "Slug must not start or end with a hyphen"
    )
    .refine((s) => !isSlugReserved(s), {
      message: "This slug is reserved and cannot be used as a tenant slug",
    }),
  displayName: z.string().min(2).max(120),
  adminEmail: z.string().email(),
  resources: z
    .object({
      database: z
        .object({ tier: ResourceTierSchema, connectionUrl: z.string().url().optional() })
        .optional(),
      identity: z
        .object({
          tier: ResourceTierSchema,
          keycloakUrl: z.string().url().optional(),
          provisionerClientId: z.string().optional(),
          provisionerClientSecret: z.string().optional(),
        })
        .optional(),
      cache: z
        .object({
          tier: ResourceTierSchema,
          redisUrl: z.string().optional(),
          adminUrl: z.string().optional(),
        })
        .optional(),
      storage: z
        .object({
          tier: ResourceTierSchema,
          bucket: z.string().optional(),
          region: z.string().optional(),
          endpoint: z.string().url().optional(),
          adminAccessKeyId: z.string().optional(),
          adminSecretAccessKey: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

// ---------------------------------------------------------------------------
// Main provisioning orchestrator
// ---------------------------------------------------------------------------

export interface ProvisionTenantResult {
  organisationId: string;
  slug: string;
  displayName: string;
  resources: TenantResourceConfig;
  realmName: string;
}

export async function provisionTenant(
  input: CreateTenantRequest,
  callerActorId: string
): Promise<ProvisionTenantResult> {
  const pool = getApplicationPool();
  const auditPort = getAuditPort();
  const cfg = getProvisioningConfig();
  const resources = mergeResourceConfig(input.resources);
  const organisationId = crypto.randomUUID();
  const realmName = `tenant-${organisationId}`;

  log.info({ slug: input.slug, organisationId, resources }, "provisioning.start");

  // All public-schema writes run under withSystemAdmin so they function
  // correctly regardless of whether the app DB user is a superuser or a
  // non-superuser with RLS enforced (ADR-0031 ?PostgreSQL privilege analysis).
  // Each withSystemAdmin block is adjacent to an audit emission.
  await withSystemAdmin(pool, async (client) => {
    // Audit: provisioning attempt
    await auditPort.emit(
      createAuditEvent({
        actorId: callerActorId,
        tenantId: "platform",
        action: AuditAction.OrganisationUpdated,
        resource: "organisation",
        resourceId: organisationId,
        metadata: { event: "provisioning.attempt", slug: input.slug },
      })
    );

    // Guard: slug must be unique (idempotency check)
    const existing = await client.query("SELECT id FROM public.organisations WHERE slug = $1", [
      input.slug,
    ]);
    if (existing.rows.length > 0) {
      throw new ConflictError(`Tenant slug "${input.slug}" is already taken`);
    }

    // Step 1: create organisation record
    await client.query(
      "INSERT INTO public.organisations (id, slug, display_name) VALUES ($1, $2, $3)",
      [organisationId, input.slug, input.displayName]
    );
  });

  // Step 2: save resource config under system admin context
  await withSystemAdmin(pool, async (client) => {
    await saveResourceConfigClient(client, organisationId, resources);
  });

  const cleanupSteps: Array<() => Promise<void>> = [];

  try {
    // Step 3: database
    await provisionDatabase(pool, organisationId, resources.database, cfg);
    cleanupSteps.push(() => dropTenantSchemaIfShared(pool, organisationId, resources.database));

    // Step 4: identity — returns auth-settings service account credential
    const authSettingsCredential = await provisionIdentity(
      organisationId,
      input.slug,
      input.displayName,
      resources.identity,
      cfg
    );
    cleanupSteps.push(() => deprovisionIdentity(realmName, resources.identity, cfg));

    // Step 4b: persist auth-settings credential so Auth Settings routes can use it
    if (authSettingsCredential) {
      const credentialStore = new PostgresTenantCredentialStore(pool);
      await credentialStore.setAuthSettingsCredential(organisationId, authSettingsCredential);
      log.info({ organisationId }, "provisioning.auth-settings-credential.stored");
    }

    // Step 5: cache
    await provisionCache(organisationId, resources.cache, cfg);
    cleanupSteps.push(() => deprovisionCache(organisationId, resources.cache, cfg));

    // Step 6: storage
    await provisionStorage(organisationId, resources.storage, cfg);
    cleanupSteps.push(() => deprovisionStorage(organisationId, resources.storage, cfg));

    // Step 7: create initial tenant-admin membership in the tenant schema
    await createInitialMembership(pool, organisationId, input.adminEmail);

    // Emit audit event ? ADR-0031 invariant: every provisioning operation is audited
    await auditPort.emit(
      createAuditEvent({
        actorId: callerActorId,
        tenantId: "platform",
        action: AuditAction.OrganisationUpdated,
        resource: "organisation",
        resourceId: organisationId,
        metadata: { slug: input.slug, resources: JSON.stringify(resources) },
      })
    );

    log.info({ slug: input.slug, organisationId }, "provisioning.complete");

    return {
      organisationId,
      slug: input.slug,
      displayName: input.displayName,
      resources,
      realmName,
    };
  } catch (err) {
    log.error({ slug: input.slug, organisationId, err: String(err) }, "provisioning.failed");
    // Best-effort cleanup in reverse order
    for (const cleanup of cleanupSteps.reverse()) {
      await cleanup().catch((e: unknown) => {
        log.error({ err: String(e) }, "provisioning.cleanup.failed");
      });
    }
    // Remove org record on failure ? also under system admin context
    await withSystemAdmin(pool, async (client) => {
      await client.query("DELETE FROM public.organisations WHERE id = $1", [organisationId]);
    }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Resource config persistence
// ---------------------------------------------------------------------------

// Client-accepting version called within a withSystemAdmin block
async function saveResourceConfigClient(
  client: pg.PoolClient,
  organisationId: string,
  resources: TenantResourceConfig
): Promise<void> {
  // Redact sensitive fields before storing (store tier + non-sensitive config only)
  await client.query(
    `INSERT INTO public.tenant_resource_config
       (organisation_id, database_tier, database_config,
        identity_tier, identity_config,
        cache_tier, cache_config,
        storage_tier, storage_config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (organisation_id) DO UPDATE SET
       database_tier = EXCLUDED.database_tier, database_config = EXCLUDED.database_config,
       identity_tier = EXCLUDED.identity_tier, identity_config = EXCLUDED.identity_config,
       cache_tier    = EXCLUDED.cache_tier,    cache_config    = EXCLUDED.cache_config,
       storage_tier  = EXCLUDED.storage_tier,  storage_config  = EXCLUDED.storage_config,
       updated_at    = now()`,
    [
      organisationId,
      resources.database.tier,
      redactSensitive({ connectionUrl: resources.database.connectionUrl }),
      resources.identity.tier,
      redactSensitive({ keycloakUrl: resources.identity.keycloakUrl }),
      resources.cache.tier,
      redactSensitive({ redisUrl: resources.cache.redisUrl }),
      resources.storage.tier,
      redactSensitive({
        bucket: resources.storage.bucket,
        region: resources.storage.region,
        endpoint: resources.storage.endpoint,
      }),
    ]
  );
}

function redactSensitive(obj: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, v!])
  );
}

export async function getTenantResourceConfig(
  pool: pg.Pool,
  organisationId: string
): Promise<TenantResourceConfig | null> {
  // Read-only withSystemAdmin ? structured log required per withSystemAdmin audit rules.
  log.info({ organisationId }, "provisioning.resource-config.read");
  const rows = await withSystemAdmin(pool, async (client) => {
    const result = await client.query<{
      database_tier: string;
      database_config: Record<string, string>;
      identity_tier: string;
      identity_config: Record<string, string>;
      cache_tier: string;
      cache_config: Record<string, string>;
      storage_tier: string;
      storage_config: Record<string, string>;
    }>("SELECT * FROM public.tenant_resource_config WHERE organisation_id = $1", [organisationId]);
    return result.rows;
  });
  if (!rows.length) return null;
  const r = rows[0]!;
  return {
    database: {
      tier: r.database_tier as TenantResourceConfig["database"]["tier"],
      ...r.database_config,
    },
    identity: {
      tier: r.identity_tier as TenantResourceConfig["identity"]["tier"],
      ...r.identity_config,
    },
    cache: { tier: r.cache_tier as TenantResourceConfig["cache"]["tier"], ...r.cache_config },
    storage: {
      tier: r.storage_tier as TenantResourceConfig["storage"]["tier"],
      ...r.storage_config,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-resource provisioning steps
// ---------------------------------------------------------------------------

async function provisionDatabase(
  pool: pg.Pool,
  organisationId: string,
  config: DatabaseResourceConfig,
  _platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<void> {
  if (config.tier === "air-gapped") return;

  const targetPool =
    config.tier === "shared"
      ? pool
      : new pg.Pool({ connectionString: config.connectionUrl, max: 2 });

  try {
    await createTenantSchema(targetPool, organisationId);
    log.info({ tier: config.tier, organisationId }, "provisioning.database.done");
  } finally {
    if (config.tier !== "shared") await targetPool.end().catch(() => undefined);
  }
}

async function dropTenantSchemaIfShared(
  pool: pg.Pool,
  organisationId: string,
  config: DatabaseResourceConfig
): Promise<void> {
  if (config.tier !== "shared") return;
  const { dropTenantSchema } = await import("@platform/adapters-postgres");
  await dropTenantSchema(pool, organisationId);
}

interface AuthSettingsCredential {
  clientId: string;
  clientSecret: string;
}

async function provisionIdentity(
  organisationId: string,
  slug: string,
  displayName: string,
  config: IdentityResourceConfig,
  platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<AuthSettingsCredential | null> {
  if (config.tier === "external" || config.tier === "air-gapped") return null;

  const keycloakAdapter = new KeycloakProvisioningAdapter({
    url: config.keycloakUrl ?? platformCfg.keycloakUrl,
    provisionerClientId: config.provisionerClientId ?? platformCfg.keycloakProvisionerClientId,
    provisionerClientSecret:
      config.provisionerClientSecret ?? platformCfg.keycloakProvisionerClientSecret,
  });

  const realmName = `tenant-${organisationId}`;
  const scheme = platformCfg.tenantUriScheme;
  const tenantOrigin = `${scheme}://${slug}.${platformCfg.apexDomain}`;

  await keycloakAdapter.createRealm({
    realmName,
    displayName,
    bffClientId: "platform-api",
    bffClientSecret: platformCfg.bffClientSecret,
    // Include the scheme-correct callback plus a wildcard for future sub-paths.
    // tenantUriScheme is derived from KC_HOSTNAME so it matches the public-facing
    // URL scheme (http for .localhost dev, https for Cloudflare production).
    bffRedirectUris: [`${tenantOrigin}/auth/callback`, `${tenantOrigin}/auth/*`],
  });

  // Create the per-tenant auth-settings service account (ADR-ACT-0186).
  // Uses minimum realm-management roles: manage-identity-providers + manage-realm.
  // The client secret is generated here and stored via the credential store.
  const authSettingsClientId = `auth-settings-${organisationId}`;
  const authSettingsClientSecret = crypto.randomUUID();

  const credential = await keycloakAdapter.createAuthSettingsServiceAccount(
    realmName,
    authSettingsClientId,
    authSettingsClientSecret
  );

  // Register platform UMA resource catalogue in tenant realm (ADR-ACT-0145).
  // Resources are registered with no policies by default — no access-control
  // behaviour change on day 1. Policies are configured via setResourcePolicy().
  await keycloakAdapter.registerPlatformResources(realmName, "platform-api");
  log.info({ organisationId }, "provisioning.uma-resources.registered");

  log.info({ tier: config.tier, organisationId }, "provisioning.identity.done");
  return credential;
}

async function deprovisionIdentity(
  realmName: string,
  config: IdentityResourceConfig,
  platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<void> {
  if (config.tier === "external" || config.tier === "air-gapped") return;
  const adapter = new KeycloakProvisioningAdapter({
    url: platformCfg.keycloakUrl,
    provisionerClientId: platformCfg.keycloakProvisionerClientId,
    provisionerClientSecret: platformCfg.keycloakProvisionerClientSecret,
  });
  await adapter.deleteRealm(realmName);
}

async function provisionCache(
  organisationId: string,
  config: CacheResourceConfig,
  platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<void> {
  if (config.tier === "external" || config.tier === "air-gapped") return;
  if (!platformCfg.redisAdminUrl && config.tier === "shared") {
    // No Redis admin URL configured ? shared mode without per-tenant ACL (dev default)
    log.info({ organisationId }, "provisioning.cache.skipped");
    return;
  }

  const adminUrl = config.adminUrl ?? config.redisUrl ?? platformCfg.redisAdminUrl;
  if (!adminUrl) return;

  const adminClient = createRedisAdminClient({ url: adminUrl });
  await adminClient.connect();
  try {
    const adapter = new RedisProvisioningAdapter(adminClient);
    const password = crypto.randomBytes(32).toString("hex");
    await adapter.createTenantUser(organisationId, password);
    log.info({ tier: config.tier, organisationId }, "provisioning.cache.done");
  } finally {
    await adminClient.disconnect().catch(() => undefined);
  }
}

async function deprovisionCache(
  organisationId: string,
  config: CacheResourceConfig,
  platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<void> {
  if (config.tier === "external" || config.tier === "air-gapped") return;
  const adminUrl = config.adminUrl ?? platformCfg.redisAdminUrl;
  if (!adminUrl) return;
  const adminClient = createRedisAdminClient({ url: adminUrl });
  await adminClient.connect();
  try {
    const adapter = new RedisProvisioningAdapter(adminClient);
    await adapter.revokeTenantUser(organisationId);
  } finally {
    await adminClient.disconnect().catch(() => undefined);
  }
}

async function provisionStorage(
  organisationId: string,
  config: StorageResourceConfig,
  platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<void> {
  if (config.tier === "external" || config.tier === "air-gapped") return;
  if (!platformCfg.s3AdminAccessKeyId || !platformCfg.s3AdminSecretAccessKey) {
    log.info({ organisationId }, "provisioning.storage.skipped");
    return;
  }

  const adapter = new S3ProvisioningAdapter({
    bucket: config.bucket ?? platformCfg.s3DefaultBucket,
    region: config.region ?? platformCfg.s3DefaultRegion,
    endpoint: config.endpoint ?? platformCfg.s3DefaultEndpoint ?? undefined,
    credentials: {
      accessKeyId: config.adminAccessKeyId ?? platformCfg.s3AdminAccessKeyId,
      secretAccessKey: config.adminSecretAccessKey ?? platformCfg.s3AdminSecretAccessKey,
    },
  });

  await adapter.createTenantUser(organisationId);
  log.info({ tier: config.tier, organisationId }, "provisioning.storage.done");
}

async function deprovisionStorage(
  organisationId: string,
  config: StorageResourceConfig,
  platformCfg: ReturnType<typeof getProvisioningConfig>
): Promise<void> {
  if (config.tier === "external" || config.tier === "air-gapped") return;
  if (!platformCfg.s3AdminAccessKeyId || !platformCfg.s3AdminSecretAccessKey) return;
  const adapter = new S3ProvisioningAdapter({
    bucket: config.bucket ?? platformCfg.s3DefaultBucket,
    region: config.region ?? platformCfg.s3DefaultRegion,
    endpoint: config.endpoint ?? platformCfg.s3DefaultEndpoint ?? undefined,
    credentials: {
      accessKeyId: platformCfg.s3AdminAccessKeyId,
      secretAccessKey: platformCfg.s3AdminSecretAccessKey,
    },
  });
  await adapter.revokeTenantUser(organisationId);
}

async function createInitialMembership(
  pool: pg.Pool,
  organisationId: string,
  adminEmail: string
): Promise<void> {
  // Use withTenant to set both search_path and app.current_tenant_id via
  // the shared tenantSchemaIdentifier helper ? no manual schema interpolation.
  // bypassRls is inherited from the surrounding withSystemAdmin if present;
  // here we use withTenant since the membership INSERT is tenant-scoped.
  // withSystemAdmin bypasses RLS on public tables (users lookup).
  // tenantSchemaIdentifier from adapters-postgres provides the safe, validated
  // schema name ? no manual string construction here.
  await withSystemAdmin(pool, async (client) => {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    // Use set_config() to set app.current_tenant_id — SET LOCAL does not
    // support bind parameters in PostgreSQL ($1 is treated as a literal).
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [organisationId]);
    // Look up the user in public.users (they may not exist yet ? JIT on first login)
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM public.users WHERE email = $1",
      [adminEmail]
    );
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO memberships (user_id, organisation_id, role)
         VALUES ($1, $2, 'tenant-admin')
         ON CONFLICT (user_id, organisation_id) DO NOTHING`,
        [rows[0]!.id, organisationId]
      );
    } else {
      // User not yet registered — create a pending invitation consumed on first login (JIT, ADR-0030 §4g)
      await client.query(
        `INSERT INTO public.pending_invitations (email, organisation_id, role)
         VALUES ($1, $2, 'tenant-admin')`,
        [adminEmail, organisationId]
      );
    }
  });
}
