# Rate-limit provider foundation (Phase 3.5)

**ADR:** ADR-0065 · **Action:** ADR-ACT-0263 · **Status:** Delivered + locally proven
**Capability:** `rate-limiting` (developer-platform)

## Scope delivered

A Redis counter provider behind the existing `RateLimitRepository` port, as a
high-throughput alternative to the Phase-3 Postgres fixed-window limiter. This is
a provider-adapter slice, not a new limiter: the usecase, contracts, routes, and
entitlement bridge are unchanged.

- **Postgres remains the durable default** and the store of record for policy
  definitions. With no configuration, behaviour is identical to Phase 3.
- **`RATE_LIMIT_PROVIDER=redis`** selects `RedisRateLimitRepository`
  (`apps/platform-api/src/adapters/redis-rate-limit-repository.ts`), wired in
  `selectRateLimitRepository` (used by both `buildRateLimitDeps` and
  `buildDeveloperPortalDeps` in `routes.ts`).
- The Redis adapter **delegates policy CRUD to Postgres** and moves only the hot
  fixed-window counter to Redis (atomic Lua `INCR` + `EXPIRE`-on-first-hit).

## Design

| Concern | Decision |
| --- | --- |
| Policy storage | Postgres (durable, RLS) — Redis never owns policy definitions |
| Counter | Redis `INCR` with `EXPIRE` set on the first hit of a bucket (atomic Lua) |
| Window math | `floor(now / windowSeconds) * windowSeconds` — identical to the Postgres adapter, so the two are interchangeable behind the port |
| TTL | `windowSeconds + 1` — the bucket self-expires one second past its window |
| Key scheme | `rl:<organisationId>:count:<policyKey>:<windowStart>` |
| Tenant isolation | organisation id is the leading key segment; no cross-tenant keys |
| Secrets | none — keys are ids, values are integers |
| Degradation | Redis unreachable → fall back to the durable Postgres counter (degrade, never fail open); `readiness()` reports `degraded`; structured warning logged |

## Environment classification

Redis is **per-environment** (sessions, queues, counters, caches, and locks are
environment-specific runtime state). It is already a default Compose service, so
this slice adds no new container and no new secrets. See
`docs/evidence/platform/provider-environment-classification.md`.

## Proof

`npm run proof:rate-limits-redis` (requires `make compose-up-default`) — live
against Compose Redis + Postgres. SKIPs honestly if either backend is down.

Checks (all PASS live):

- readiness reports `ready` on PONG;
- allow / allow / deny within the fixed window (counts in Redis);
- per-tenant isolation: orgA and orgB use distinct keys, counts independent;
- counter keys are tenant-prefixed; no secret-bearing keys; values are integers;
- counter bucket carries a self-expiring TTL;
- the fixed window resets in the next bucket;
- Redis unavailable → `degraded` readiness AND the Postgres fallback still counts.

`apps/platform-api/tests/unit/redis-rate-limit-repository.test.ts` (node:test) —
delegation, tenant-prefixed keys, TTL-on-first-hit, currentCount read-only,
fallback on Redis error, rethrow when fallback disabled, readiness ready/degraded.

## Not delivered

- Redis is **counter-only**; policy definitions stay in Postgres.
- No sliding-window or token-bucket algorithm (fixed window only, matching Phase 3).
- No per-environment Redis ACL provisioning for the limiter (uses the shared
  application Redis connection; ADR-0031 ACL provisioning is a separate concern).
