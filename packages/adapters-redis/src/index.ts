import { createClient, type RedisClientType } from "redis";
import {
  SESSION_COOKIE_NAME,
  type SessionStore,
  type SessionRecord,
  type CreateSessionCommand,
} from "@platform/session-runtime";
import crypto from "node:crypto";

export const PACKAGE_NAME = "@platform/adapters-redis";
export { SESSION_COOKIE_NAME };

// ---------------------------------------------------------------------------
// Redis client factory
// ---------------------------------------------------------------------------

export function createRedisClient(url: string): RedisClientType {
  return createClient({ url }) as RedisClientType;
}

// ---------------------------------------------------------------------------
// RedisSessionStore ? implements SessionStore from session-runtime
//
// Key scheme:  session:<sessionId>
// Value:       JSON-serialised SessionRecord
// TTL:         set on create; refreshable via refresh()
// ---------------------------------------------------------------------------

export class RedisSessionStore implements SessionStore {
  private readonly client: RedisClientType;
  private readonly keyPrefix: string;

  constructor(client: RedisClientType, keyPrefix = "session:") {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async create(command: CreateSessionCommand): Promise<string> {
    const sessionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + command.ttlSeconds * 1000);
    const record: SessionRecord = {
      sessionId,
      userId: command.userId,
      tenantId: command.tenantId,
      organisationId: command.organisationId,
      roles: command.roles,
      permissions: command.permissions,
      displayName: command.displayName,
      expiresAt,
      createdAt: now,
    };
    await this.client.set(this.keyPrefix + sessionId, JSON.stringify(record), {
      EX: command.ttlSeconds,
    });
    return sessionId;
  }

  async find(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.client.get(this.keyPrefix + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionRecord & {
      expiresAt: string;
      createdAt: string;
    };
    return {
      ...parsed,
      expiresAt: new Date(parsed.expiresAt),
      createdAt: new Date(parsed.createdAt),
    };
  }

  async refresh(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(this.keyPrefix + sessionId, ttlSeconds);
  }

  async destroy(sessionId: string): Promise<void> {
    await this.client.del(this.keyPrefix + sessionId);
  }
}

// ---------------------------------------------------------------------------
// RedisAuthStateStore ? one-time PKCE state storage
//
// Key scheme:  auth_state:<state>
// Value:       JSON { codeVerifier, returnTo }
// TTL:         short (5 minutes) ? consumed on first read
//
// `take()` is consume-once: reads the value then deletes it atomically.
// This prevents replay attacks on the OAuth state parameter.
// ---------------------------------------------------------------------------

export interface AuthStatePayload {
  codeVerifier: string;
  returnTo: string;
  /** Pre-auth nonce: matches the auth_state_token cookie set in /auth/login.
   *  Verified in /auth/callback to bind the flow to the initiating user-agent. */
  nonce: string;
}

export class RedisAuthStateStore {
  private readonly client: RedisClientType;
  private readonly keyPrefix: string;

  constructor(client: RedisClientType, keyPrefix = "auth_state:") {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async put(state: string, payload: AuthStatePayload, ttlSeconds = 300): Promise<void> {
    await this.client.set(this.keyPrefix + state, JSON.stringify(payload), { EX: ttlSeconds });
  }

  /** Consume-once: reads AND deletes the state entry. Returns null if already consumed or expired. */
  async take(state: string): Promise<AuthStatePayload | null> {
    const key = this.keyPrefix + state;
    const raw = await this.client.getDel(key);
    if (!raw) return null;
    return JSON.parse(raw) as AuthStatePayload;
  }
}

// ---------------------------------------------------------------------------
// createRedisAdminClient ? admin connection for ACL user management
// ADR-0031: used only by the provisioning path, never in request handlers.
// Connects as a Redis user with +acl command permission.
// ---------------------------------------------------------------------------

export interface RedisAdminConfig {
  url: string;
  username?: string;
  password?: string;
}

export function createRedisAdminClient(config: RedisAdminConfig): RedisClientType {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
  }) as RedisClientType;
}

// ---------------------------------------------------------------------------
// RedisProvisioningAdapter ? creates/revokes per-tenant ACL users (ADR-0031)
// ---------------------------------------------------------------------------

export interface RedisAclUser {
  username: string;
  keyPattern: string;
}

export class RedisProvisioningAdapter {
  private readonly client: RedisClientType;

  constructor(adminClient: RedisClientType) {
    this.client = adminClient;
  }

  async createTenantUser(organisationId: string, password: string): Promise<RedisAclUser> {
    const username = `tenant_${organisationId.replaceAll("-", "_")}`;
    const keyPattern = `t:${organisationId}:*`;
    // Redis ACL SETUSER: enable user, set password, restrict to key pattern, allow read/write
    await (
      this.client as unknown as { sendCommand: (args: string[]) => Promise<unknown> }
    ).sendCommand([
      "ACL",
      "SETUSER",
      username,
      "on",
      `>${password}`,
      `~${keyPattern}`,
      "+@read",
      "+@write",
      "+@string",
      "+@hash",
      "+@set",
    ]);
    return { username, keyPattern };
  }

  async revokeTenantUser(organisationId: string): Promise<void> {
    const username = `tenant_${organisationId.replaceAll("-", "_")}`;
    await (
      this.client as unknown as { sendCommand: (args: string[]) => Promise<unknown> }
    ).sendCommand(["ACL", "DELUSER", username]);
  }
}
