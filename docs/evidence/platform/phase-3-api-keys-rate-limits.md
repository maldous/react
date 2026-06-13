# Phase 3 — developer platform foundation: API keys + rate limits (delivery evidence)

- **Action:** ADR-ACT-0257 — governing ADR: ADR-0065 (developer platform & API management, **Accepted** for the Phase-3 foundation; SDK generation, external portal/gateway, sandbox mode, and full schema-level OpenAPI drift remain **Proposed** sub-decisions).
- **Date:** 2026-06-13
- **Status of this document:** delivery evidence. The Universal Service Foundation is **not** complete. Phase 3 is the API-key + rate-limit + read-only developer foundation only; no external portal, SDK pipeline, or sandbox is delivered.

## Proof classification

**Live-proven** against the local Compose Postgres (real RLS) — the new proofs run repos as the non-superuser `platform_app` role, create + clean up their own test orgs, and SKIP honestly (exit 0) if Postgres is unavailable:

- `proof:api-keys` — server-generated secret returned **once** (`sk_` prefix); only a salted+peppered hash stored; **the stored hash cannot authenticate as the plaintext**; creation **entitlement-gated** (`api_access`, deny-by-default); valid secret authenticates; **revoked key denied**; **RLS tenant isolation** (foreign-tenant context sees 0 keys); operator (rls_bypass) can list a tenant's keys; list/read carry no secret or hash; no plaintext-secret columns.
- `proof:rate-limits` — operator sets a policy (audited); **entitlement bridge** denies before counting when not entitled; **allow below limit, deny above limit** within the fixed window; **RLS isolation** of policies; live window count reported; no secret columns.
- `proof:api-key-routes` — invokes the **real route handlers**: tenant self-service create returns the secret once; missing tenant context rejected; org list omits the secret; developer foundation summary; operator key read + rate-limit set/read; revoke; invalid ids rejected; access-control metadata asserted.

In-memory `node:test` suites (`api-keys`, `rate-limits`) cover the crypto + usecase logic without infra (12 cases incl. plaintext-shown-once, hash≠plaintext, audit-before-change abort, entitlement-bridge ordering, allow/deny boundary).

## Delivered

1. **API-key crypto** — `api-key-crypto.ts`: `generateApiKey` (random `sk_` secret, derived non-secret `pk_` prefix, per-key salt, scrypt hash with server pepper `API_KEY_PEPPER`), `prefixForSecret`, constant-time `verifyApiKey` (`timingSafeEqual`).
2. **API-key model** — `api_keys` (migration 025): tenant-scoped, **RLS enabled + forced** (canonical inherit-aware bypass predicate), `key_prefix` (UNIQUE lookup handle), `key_hash` + `key_salt` (no plaintext), `scopes`, `expires_at`, `revoked_at`. `ApiKeyRepository` port + `PostgresApiKeyRepository` (tenant self-list via `withTenant`; create/operator/verify/touch via `withSystemAdmin`).
3. **API-key usecase** — `createApiKey` (entitlement-gated, **audit-before-change**, secret shown once), `listApiKeys` (no secret/hash), `revokeApiKey` (audited), `authenticateApiKey` (prefix lookup → constant-time verify → reject revoked/expired → re-check entitlement → touch last-used).
4. **Rate-limit model** — `rate_limit_policies` + durable fixed-window `rate_limit_counters` (migration 025, both RLS). `RateLimitRepository` port + `PostgresRateLimitRepository` (atomic `incrementAndCount` upsert; server-clock window bucket).
5. **Rate-limit usecase** — `evaluateRateLimit`/`assertRateLimit` (chain: **entitlement → limit**, deny-by-default, the bridge to the quota/entitlement substrate; no policy ⇒ allowed), `listRateLimits` (live window count + state), `setRateLimit` (operator-only, **audit-before-change**, `rate_limit.set`). `getDeveloperPortal` (read-only foundation summary).
6. **Routes** (+ OpenAPI): `GET/POST /api/org/api-keys`, `DELETE /api/org/api-keys/:keyId`, `GET /api/org/developer`, `GET /api/org/rate-limits`, `GET /api/admin/tenants/:tenantId/api-keys`, `GET/PATCH /api/admin/tenants/:tenantId/rate-limits`.
7. **Permissions** — `tenant.api_keys.read|write` + `tenant.developer.read` (tenant), `platform.api_keys.read` + `platform.rate_limits.read|write` (operator) in `domain-identity`; the `api_access` entitlement added to the catalog.
8. **UI** — `/admin/developer`: tenant self-service (create key + **one-time secret reveal** + revoke + API-surface foundation card + rate-limit read) when not an operator; operator console (tenant lookup + rate-limit set + cross-tenant key/policy read) for `platform.rate_limits.write`. REST-over-BFF; React renders BFF state and shows the one-time secret only.
9. **Contracts** — API-key + rate-limit + developer-portal schemas in `@platform/contracts-admin`; `api_key` + `rate_limit` audit resources; `rate_limit.set` action (`api_key.created`/`api_key.revoked` already present).

## Enforced invariants (proven)

Keys server-generated; only a salted+peppered hash stored; plaintext shown once + unrecoverable; the stored hash cannot authenticate as the plaintext; keys tenant-scoped (RLS) + revocable + entitlement-gated; revoked/expired denied; no secret in list/read; issue + revoke audited (audit-before-change). Rate limits allow below / deny above within the window; entitlement checked before the limit (deny-by-default); policy changes audited; React makes no rate-limit decision (server-authoritative); no secret columns; no paid provider in local proof.

## Still NOT delivered (explicitly)

- **Redis-backed rate limiter** — Phase 3.5, behind the `RateLimitRepository` port (sub-second windows / high volume). Postgres fixed-window is the local-first store.
- **External developer portal / API gateway** (Backstage / Kong OSS), **SDK generation**, **sandbox/test mode** — ADR-0065 Proposed sub-decisions; not delivered.
- **Schema-level OpenAPI drift** — drift today covers path+method presence; request/response schema enforcement precedes a published portal.
- Search, event bus, durable workers, profile self-service, notifications, observability/alerting — later phases (4–7), still Proposed/scoped.

## Governance

- ADR-0065 **hardened to decision quality + Accepted** (Phase-3 foundation) on Matt's authority; SDK/portal-gateway/sandbox/full-drift kept Proposed within the ADR. CODEMAPS updated (ADR-0065 → Accepted).
- Registry: `api-keys-pat` → **locally proven**; new **`rate-limiting`** capability → **locally proven**; `api-docs-portal-sdk-ratelimits` bundle stays **partial** (portal/SDK/sandbox/full-drift deferred). `delivery` gains a `rate-limiting` row + a `phase-3` gate (requires ADR-0065 ready). Validator + matrix re-rendered.

## Commands run (green)

`npm run usf:validate`, `lint:md`, `test:architecture`, `tsc:check`, `openapi:drift`, `frontend:conventions`, `semgrep:gate`, `test:platform-api`, `test:frontend:run`, all prior proofs, `proof:api-keys` (live), `proof:rate-limits` (live), `proof:api-key-routes` (live), `audit:osv`, `audit:deps`, `make check`.
