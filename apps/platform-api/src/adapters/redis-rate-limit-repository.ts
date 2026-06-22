/**
 * RedisRateLimitRepository (ADR-0065 / ADR-ACT-0257 — Phase 3.5 provider behind RateLimitRepository).
 *
 * Redis is the high-throughput *counter* provider; it does NOT own policy
 * definitions. Policy CRUD (getByKey/listForTenant/listForTenantAsOperator/upsert)
 * delegates to a durable repository (Postgres) so the operator-managed policy set
 * stays in the relational store of record. Only the hot fixed-window counter moves
 * to Redis, where INCR + EXPIRE is atomic and cheap at request volume.
 *
 * Fixed-window math is identical to PostgresRateLimitRepository:
 *   windowStart = floor(nowSeconds / windowSeconds) * windowSeconds
 * so the same (org, policy, windowSeconds) bucket boundary holds regardless of
 * which provider is active — the two are interchangeable behind the port.
 *
 * Tenant isolation: the organisation id is the leading segment of every counter
 * key (rl:<org>:count:<policyKey>:<windowStart>). There are no cross-tenant keys
 * and no secret material in any key or value (counts are integers).
 *
 * Honest degradation (no fake readiness): if Redis is unreachable the counter
 * operations fall back to the durable delegate (Postgres), `readiness()` reports
 * `degraded`, and a structured warning is logged. The limiter therefore keeps
 * working on the Postgres fallback rather than failing open.
 */

import type { RedisClientType } from "redis";
import type {
  RateLimitPolicyRecord,
  RateLimitRepository,
  UpsertRateLimitInput,
} from "../ports/rate-limit-repository.ts";

export const redisRateLimitRepositoryReliabilityEvidence = {
  provider: "redis-rate-limit-repository",
  configSource:
    "Redis client and fallback delegate are constructed from process.env-backed runtime dependencies before repository creation",
  secretSource:
    "Redis credentials stay inside the injected client; keys and values contain no secret material",
  timeout: "eval/get/ping operations are bounded by commandTimeoutMs through withTimeout",
  retry:
    "no retry inside the adapter: failed Redis counter operations fall back once to the durable delegate rather than replaying writes",
  degradedMode:
    "Redis errors degrade to durable Postgres counting when fallbackToDelegate is enabled",
  failClosed:
    "when fallbackToDelegate=false Redis failures throw; the adapter never returns an allowed count from an unknown state",
  fallbackRationale:
    "Postgres fallback preserves rate-limit enforcement when the hot Redis counter provider is unavailable",
  healthCheck: "readiness performs a bounded Redis PING and reports degraded on failure",
  operatorRecovery:
    "operators recover by repairing Redis connectivity, checking readiness, and relying on the durable Postgres counter fallback during outage",
  unavailableProof: "apps/platform-api/scripts/redis-rate-limit-repository-runtime-proof.ts",
  misconfiguredProof: "apps/platform-api/scripts/redis-rate-limit-repository-runtime-proof.ts",
} as const;

export interface RateLimitProviderReadiness {
  provider: "redis";
  status: "ready" | "degraded";
  detail: string;
}

export interface RedisRateLimitOptions {
  /** Counter key namespace. Default "rl:". */
  keyPrefix?: string;
  /** Fall back to the durable delegate's counter when Redis errors. Default true. */
  fallbackToDelegate?: boolean;
  /** Redis command timeout in milliseconds. Default 1000. */
  commandTimeoutMs?: number;
  /** Structured warn sink (no secrets). Defaults to a no-op. */
  warn?: (message: string, meta: Record<string, unknown>) => void;
}

// Atomic increment for the current window: INCR, and only on the *first* hit of a
// new bucket set the TTL so the window self-expires. Returns the running count.
const INCREMENT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`redis_${operation}_timeout`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class RedisRateLimitRepository implements RateLimitRepository {
  private readonly client: RedisClientType;
  private readonly delegate: RateLimitRepository;
  private readonly keyPrefix: string;
  private readonly fallbackToDelegate: boolean;
  private readonly commandTimeoutMs: number;
  private readonly warn: (message: string, meta: Record<string, unknown>) => void;

  /**
   * @param client   a redis client (caller owns connect/disconnect lifecycle).
   * @param delegate durable policy store + counter fallback (PostgresRateLimitRepository).
   */
  constructor(
    client: RedisClientType,
    delegate: RateLimitRepository,
    options: RedisRateLimitOptions = {}
  ) {
    this.client = client;
    this.delegate = delegate;
    this.keyPrefix = options.keyPrefix ?? "rl:";
    this.fallbackToDelegate = options.fallbackToDelegate ?? true;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 1000;
    this.warn = options.warn ?? (() => {});
  }

  // ── Policy definitions: durable store of record (delegated) ────────────────
  getByKey(organisationId: string, policyKey: string): Promise<RateLimitPolicyRecord | null> {
    return this.delegate.getByKey(organisationId, policyKey);
  }

  listForTenant(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return this.delegate.listForTenant(organisationId);
  }

  listForTenantAsOperator(organisationId: string): Promise<RateLimitPolicyRecord[]> {
    return this.delegate.listForTenantAsOperator(organisationId);
  }

  upsert(input: UpsertRateLimitInput): Promise<void> {
    return this.delegate.upsert(input);
  }

  // ── Hot counter: Redis with honest Postgres fallback ───────────────────────
  private windowStart(windowSeconds: number): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  }

  private counterKey(organisationId: string, policyKey: string, windowStart: number): string {
    return `${this.keyPrefix}${organisationId}:count:${policyKey}:${windowStart}`;
  }

  async incrementAndCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    const windowStart = this.windowStart(windowSeconds);
    const key = this.counterKey(organisationId, policyKey, windowStart);
    try {
      const result = await withTimeout(
        this.client.eval(INCREMENT_SCRIPT, {
          keys: [key],
          // EXPIRE the bucket one second past the window so a count never outlives
          // its window even with clock jitter at the boundary.
          arguments: [String(windowSeconds + 1)],
        }),
        this.commandTimeoutMs,
        "eval"
      );
      return Number(result);
    } catch (error) {
      if (!this.fallbackToDelegate) throw error;
      this.warn("rate-limit redis counter unavailable; falling back to durable store", {
        provider: "redis",
        op: "incrementAndCount",
        organisationId,
        policyKey,
      });
      return this.delegate.incrementAndCount(organisationId, policyKey, windowSeconds);
    }
  }

  async currentCount(
    organisationId: string,
    policyKey: string,
    windowSeconds: number
  ): Promise<number> {
    const windowStart = this.windowStart(windowSeconds);
    const key = this.counterKey(organisationId, policyKey, windowStart);
    try {
      const raw = await withTimeout(this.client.get(key), this.commandTimeoutMs, "get");
      return raw == null ? 0 : Number(raw);
    } catch (error) {
      if (!this.fallbackToDelegate) throw error;
      this.warn("rate-limit redis counter unavailable; falling back to durable store", {
        provider: "redis",
        op: "currentCount",
        organisationId,
        policyKey,
      });
      return this.delegate.currentCount(organisationId, policyKey, windowSeconds);
    }
  }

  /**
   * Honest readiness probe (never faked): PINGs Redis. `ready` only when the live
   * connection answers; otherwise `degraded` (the limiter still runs on the
   * durable Postgres fallback). Carries no secrets.
   */
  async readiness(): Promise<RateLimitProviderReadiness> {
    try {
      const pong = await withTimeout(this.client.ping(), this.commandTimeoutMs, "ping");
      if (typeof pong === "string" && pong.toUpperCase() === "PONG") {
        return { provider: "redis", status: "ready", detail: "redis reachable (PONG)" };
      }
      return { provider: "redis", status: "degraded", detail: "unexpected PING reply" };
    } catch {
      return {
        provider: "redis",
        status: "degraded",
        detail: "redis unreachable; using durable Postgres fallback",
      };
    }
  }
}
