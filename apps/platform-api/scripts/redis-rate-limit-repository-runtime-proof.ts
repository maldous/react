/**
 * Provider-ID entrypoint for the RedisRateLimitRepository live proof.
 *
 * The substantive proof remains `rate-limits-redis-runtime-proof.ts`; this file
 * keeps provider-level proof lookup exact for the adapter basename.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync(
  "apps/platform-api/scripts/rate-limits-redis-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/redis-rate-limit-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("third request denied") &&
    proofSource.includes("counter bucket has a self-expiring TTL") &&
    proofSource.includes("fixed window resets in the next bucket") &&
    adapterSource.includes("redis.call('INCR'"),
  "Redis rate-limit wrapper must assert Redis counter state, TTL, fixed-window, and deny side effects"
);
assert.ok(
  proofSource.includes("Redis-unavailable readiness reports degraded") &&
    proofSource.includes("Postgres fallback remains valid when Redis is down") &&
    adapterSource.includes("fallbackToDelegate=false Redis failures throw"),
  "Redis rate-limit wrapper must assert degraded readiness, durable fallback, and fail-closed modes"
);

import "./rate-limits-redis-runtime-proof.ts";
