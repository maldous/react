/**
 * Dependency composition root for platform-api.
 *
 * Centralises URL/config lookup and adapter construction so route handlers do
 * not duplicate wiring code. Intentionally minimal — not a DI container.
 */
import { PostgresOrganisationRepository } from "../adapters/postgres-organisation-repository.ts";
import { PostgresReadinessAdapter } from "../adapters/postgres-readiness-adapter.ts";
import { PostgresIdentityRepository } from "../adapters/postgres-identity-repository.ts";
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

// Shared singletons — adapters back themselves with a pg.Pool so repeated
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
// Keycloak configuration (read from env — never committed)
// ---------------------------------------------------------------------------

export function getKeycloakConfig(): KeycloakClientConfig {
  return {
    url: process.env["KEYCLOAK_URL"] ?? "http://localhost:8080",
    realm: process.env["KEYCLOAK_REALM"] ?? "platform",
    clientId: process.env["KEYCLOAK_CLIENT_ID"] ?? "platform-api",
    clientSecret: process.env["KEYCLOAK_CLIENT_SECRET"] ?? "",
  };
}

export function getAuthCallbackUrl(): string {
  const apiUrl = process.env["PLATFORM_API_URL"] ?? "http://localhost:3001";
  return `${apiUrl}/auth/callback`;
}

export function getAppBaseUrl(): string {
  return process.env["APP_BASE_URL"] ?? "http://localhost:5173";
}

/** Connect the Redis client (call once at server startup). */
export async function connectRedis(): Promise<void> {
  await getRedisClient().connect();
}

/** Disconnect Redis and reset singletons (useful in tests between describe blocks). */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.disconnect();
    redisClient = undefined;
    sessionStore = undefined;
    authStateStore = undefined;
  }
}
