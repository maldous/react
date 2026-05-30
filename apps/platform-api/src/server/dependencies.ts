/**
 * Dependency composition root for platform-api.
 *
 * Centralises URL/config lookup and adapter construction so route handlers do
 * not duplicate wiring code. Intentionally minimal ? not a DI container.
 *
 * ADR-0022 requires Redis-backed server-side sessions (BFF session model).
 * The Redis client, RedisSessionStore, and RedisAuthStateStore are singleton
 * singletons so the same connection pool is reused across requests. This is
 * the standard Node.js pattern for long-lived service connections.
 * connectRedis() must be called once at server startup; disconnectRedis()
 * on graceful shutdown (or between tests to release the connection pool).
 */
import pg from "pg";
import {
  PostgresOrganisationRepository,
  PostgresReadinessAdapter,
  PostgresIdentityRepository,
} from "@platform/adapters-postgres";
import {
  createRedisClient,
  RedisSessionStore,
  RedisAuthStateStore,
} from "@platform/adapters-redis";
import type { KeycloakClientConfig } from "@platform/adapters-keycloak";
import type { OrganisationRepository } from "../ports/organisation-repository.ts";
import type { IdentityRepository } from "../ports/identity-repository.ts";
import type { SessionStore } from "@platform/session-runtime";

const DEFAULT_POSTGRES_URL = "postgresql://platform:platformpassword@localhost:5433/platform";

export function getPostgresUrl(): string {
  return process.env["POSTGRES_URL"] ?? DEFAULT_POSTGRES_URL;
}

// Shared application pool ? used by withTenant, withSystemAdmin, provisioning.
// Two connections reserved for provisioning operations (schema creation, migrations).
let _appPool: pg.Pool | undefined;

export function getApplicationPool(): pg.Pool {
  if (!_appPool) {
    _appPool = new pg.Pool({ connectionString: getPostgresUrl(), max: 12 });
  }
  return _appPool;
}

// ---------------------------------------------------------------------------
// Provisioning credentials (loaded from env / secret store at startup)
// Separate from runtime credentials ? never exposed to request handlers.
// ADR-0031: trusted provisioning broker model.
// ---------------------------------------------------------------------------

export interface ProvisioningConfig {
  keycloakUrl: string;
  keycloakProvisionerClientId: string;
  keycloakProvisionerClientSecret: string;
  redisAdminUrl: string | null;
  s3AdminAccessKeyId: string | null;
  s3AdminSecretAccessKey: string | null;
  s3DefaultBucket: string;
  s3DefaultRegion: string;
  s3DefaultEndpoint: string | null;
  apexDomain: string;
  bffClientSecret: string;
}

export function getProvisioningConfig(): ProvisioningConfig {
  return {
    keycloakUrl: process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc",
    keycloakProvisionerClientId:
      process.env["KEYCLOAK_PROVISIONER_CLIENT_ID"] ?? "platform-provisioner",
    keycloakProvisionerClientSecret: process.env["KEYCLOAK_PROVISIONER_CLIENT_SECRET"] ?? "",
    redisAdminUrl: process.env["REDIS_ADMIN_URL"] ?? null,
    s3AdminAccessKeyId: process.env["S3_ADMIN_ACCESS_KEY_ID"] ?? null,
    s3AdminSecretAccessKey: process.env["S3_ADMIN_SECRET_ACCESS_KEY"] ?? null,
    s3DefaultBucket: process.env["S3_DEFAULT_BUCKET"] ?? "platform-data",
    s3DefaultRegion: process.env["S3_DEFAULT_REGION"] ?? "us-east-1",
    s3DefaultEndpoint: process.env["S3_DEFAULT_ENDPOINT"] ?? null,
    apexDomain: process.env["APEX_DOMAIN"] ?? "aldous.info",
    bffClientSecret: process.env["KEYCLOAK_CLIENT_SECRET"] ?? "",
  };
}

// Shared singletons ? adapters back themselves with a pg.Pool so repeated
// access does not open a fresh client per request.
let organisationRepository: OrganisationRepository | undefined;
let readinessAdapter: PostgresReadinessAdapter | undefined;

export function getOrganisationRepository(): OrganisationRepository {
  if (!organisationRepository) {
    organisationRepository = new PostgresOrganisationRepository(getPostgresUrl());
  }
  return organisationRepository;
}

export function getPostgresReadinessAdapter(): PostgresReadinessAdapter {
  if (!readinessAdapter) {
    readinessAdapter = new PostgresReadinessAdapter(getPostgresUrl());
  }
  return readinessAdapter;
}

export interface OrganisationDependencies {
  organisations: OrganisationRepository;
}

/**
 * Build the dependency bundle handed to organisation use cases.
 * Tests can substitute by passing their own bundle directly to the use case.
 */
export function createOrganisationDependencies(): OrganisationDependencies {
  return { organisations: getOrganisationRepository() };
}

// ---------------------------------------------------------------------------
// Redis + session infrastructure
// ---------------------------------------------------------------------------

export function getRedisUrl(): string {
  return process.env["REDIS_URL"] ?? "redis://localhost:6379";
}

let redisClient: ReturnType<typeof createRedisClient> | undefined;
let sessionStore: RedisSessionStore | undefined;
let authStateStore: RedisAuthStateStore | undefined;
let identityRepository: IdentityRepository | undefined;

export function getRedisClient(): ReturnType<typeof createRedisClient> {
  if (!redisClient) {
    redisClient = createRedisClient(getRedisUrl());
  }
  return redisClient;
}

export function getSessionStore(): SessionStore {
  if (!sessionStore) {
    sessionStore = new RedisSessionStore(getRedisClient());
  }
  return sessionStore;
}

export function getAuthStateStore(): RedisAuthStateStore {
  if (!authStateStore) {
    authStateStore = new RedisAuthStateStore(getRedisClient());
  }
  return authStateStore;
}

export function getIdentityRepository(): IdentityRepository {
  if (!identityRepository) {
    identityRepository = new PostgresIdentityRepository(getPostgresUrl());
  }
  return identityRepository;
}

// ---------------------------------------------------------------------------
// Keycloak configuration (read from env ? never committed)
// ---------------------------------------------------------------------------

export function getKeycloakConfig(): KeycloakClientConfig {
  return {
    url: process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc",
    realm: process.env["KEYCLOAK_REALM"] ?? "platform",
    clientId: process.env["KEYCLOAK_CLIENT_ID"] ?? "platform-api",
    clientSecret: process.env["KEYCLOAK_CLIENT_SECRET"] ?? "",
    // KEYCLOAK_PUBLIC_URL: public base URL for browser redirects (e.g. http://aldous.info/kc).
    // When absent, falls back to KEYCLOAK_URL ? correct for local dev without Caddy proxy.
    publicUrl: process.env["KEYCLOAK_PUBLIC_URL"],
  };
}

/** Per-tenant Keycloak config ? selects the correct realm for the FQDN tenant. ADR-0029 ?2b. */
export function getKeycloakConfigForRealm(realmName: string): KeycloakClientConfig {
  return {
    url: process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc",
    realm: realmName,
    clientId: process.env["KEYCLOAK_CLIENT_ID"] ?? "platform-api",
    clientSecret: process.env["KEYCLOAK_CLIENT_SECRET"] ?? "",
    publicUrl: process.env["KEYCLOAK_PUBLIC_URL"],
  };
}

/**
 * Build the OAuth callback URL from the request host header.
 *
 * Using the request host makes the callback URL dynamic across all tenants and
 * vanity domains without any per-tenant config ? aldous.info, tenant1.aldous.info,
 * or any custom domain all resolve correctly at runtime (ADR-0029 ?2b).
 *
 * Falls back to PLATFORM_API_URL when no host is provided (e.g. tests, local dev).
 */
/** True for loopback hosts ? always HTTP, never publicly routable.
 *
 * In addition to standard loopback hostnames (localhost, 127.0.0.1, ::1),
 * accepts any host ending in `.localhost` per RFC 6761. This special-use
 * TLD always resolves to 127.0.0.1 on all operating systems and browsers,
 * making dev.localhost, test.localhost, and multi-tenant subdomains such
 * as tenant1.dev.localhost work without /etc/hosts (ADR-0033).
 */
export function isLoopback(host: string): boolean {
  const h = (host.split(":")[0] ?? "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  );
}

/** Derive scheme from X-Forwarded-Proto or loopback detection. */
export function schemeFor(host: string, forwardedProto?: string): string {
  if (forwardedProto === "https" || forwardedProto === "http") return forwardedProto;
  return isLoopback(host) ? "http" : "https";
}

/**
 * Validate the host against the apex domain allowlist.
 *
 * Accepts: loopback hosts (tests/local-dev), APEX_DOMAIN itself, and any
 * *.APEX_DOMAIN subdomain (tenant FQDNs). Rejects anything else to prevent
 * host-header injection from constructing attacker-controlled OAuth redirect URIs.
 *
 * Note: Caddy rewrites X-Forwarded-Host from its own virtual-host config, not
 * from the client request, so this is defence-in-depth rather than the primary guard.
 */
export function isAllowedHost(host: string): boolean {
  const h = (host.split(":")[0] ?? "").toLowerCase();
  if (isLoopback(h)) return true;
  const apex = (process.env["APEX_DOMAIN"] ?? "aldous.info").toLowerCase();
  return h === apex || h.endsWith(`.${apex}`);
}

export function getAuthCallbackUrl(host?: string, forwardedProto?: string): string {
  if (host && isAllowedHost(host)) {
    return `${schemeFor(host, forwardedProto)}://${host}/auth/callback`;
  }
  const apiUrl = process.env["PLATFORM_API_URL"] ?? "http://localhost:3001";
  return `${apiUrl}/auth/callback`;
}

/**
 * Build the Keycloak public URL (browser-facing) from the request host.
 *
 * Every tenant and vanity domain gets the correct /kc path on their own origin.
 * Host is validated against the apex domain allowlist before use.
 * Falls back to KEYCLOAK_PUBLIC_URL env var when no host is provided or allowed.
 */
export function getKeycloakPublicUrl(host?: string, forwardedProto?: string): string {
  if (host && isAllowedHost(host)) {
    return `${schemeFor(host, forwardedProto)}://${host}/kc`;
  }
  return (
    process.env["KEYCLOAK_PUBLIC_URL"] ?? process.env["KEYCLOAK_URL"] ?? "http://localhost:8090/kc"
  );
}

export function getAppBaseUrl(): string {
  return process.env["APP_BASE_URL"] ?? "http://localhost:5173";
}

/** Connect the Redis client (call once at server startup).
 *
 * Idempotent: if the client is already connected, returns immediately.
 * This is safe to call across test `describe` blocks even if `disconnectRedis()`
 * was skipped due to a cancelled test parent (node:test cancels after() when
 * a describe block is torn down mid-flight).
 *
 * Uses `client.isOpen` (redis v4) to avoid duplicate connect() calls instead
 * of relying on error-message matching.
 */
export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  if (!client.isOpen) {
    await client.connect();
  }
}

/** Disconnect Redis and reset singletons (useful in tests between describe blocks). */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.disconnect();
    } catch {
      // Swallow disconnect errors so test after() hooks always complete.
    }
    redisClient = undefined;
    sessionStore = undefined;
    authStateStore = undefined;
  }
}
