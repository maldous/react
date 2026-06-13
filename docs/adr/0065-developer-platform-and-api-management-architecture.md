# ADR-0065: Developer platform and API management architecture

## Status

Accepted (2026-06-13, ADR-ACT-0257 — Phase 3 foundation; accepted on Matt's authority per the directive). SDK generation, an external developer-portal/gateway, sandbox/test mode, and complete schema-level OpenAPI drift enforcement remain **Proposed** sub-decisions within this ADR (not delivered).

## Date

2026-06-13

## Decision owner

Architecture owner / technical lead

## Consulted

Engineering; product; security; AI assistant (drafting, human review required).

## Context

Webhooks are delivered and proven (ADR-0051/0052). An OpenAPI baseline exists (`docs/api/openapi.json`) with drift enforcement over the BFF route table (`openapi:drift`), GraphQL is the primary client boundary (ADR-0013), and entitlements + metering + quota are delivered (ADR-0058/0067). There were no API keys/PATs, no rate limits, and no developer surface. Phase 3 delivers the **foundation**: server-generated API keys, durable rate limiting, and a read-only developer portal — not a full external portal/gateway or SDK pipeline.

## Decision (Phase 3 — accepted)

1. **API keys / PATs (build):** keys are **server-generated**. Only a **salted (per-key) + peppered (server-wide, `API_KEY_PEPPER`) scrypt hash** is stored; the plaintext secret (`sk_…`) is returned **exactly once** on creation and is unrecoverable thereafter. A non-secret prefix (`pk_…`) is the lookup handle. Keys are **tenant-scoped** (RLS), **revocable**, **entitlement-gated** (`api_access`, deny-by-default), and carry coarse scopes. No list/read route ever returns the secret or the hash. Issue + revoke are audited (audit-before-change). Verification is constant-time and rejects revoked/expired keys. The secret-handling pattern reuses the write-only + redaction discipline of auth credentials (ADR-0044).
2. **Rate limits (build):** a `RateLimitRepository` port with a **durable Postgres fixed-window counter** adapter (`rate_limit_counters`) plus operator-managed per-tenant policies (`rate_limit_policies`). Each policy carries an `entitlement_key` — the **bridge to the entitlement/quota substrate**: evaluation is **entitlement → limit**, deny-by-default, the same ordering as quota (ADR-0067). Policy changes are audited; denials throw a typed `platform-errors` error. **Redis-backed limiting is Phase 3.5**, added behind the same port (sub-second windows / very high volume); not in this pass.
3. **Developer portal foundation (build, read-only):** `GET /api/org/developer` returns a non-secret summary (api_access entitlement, active key count, GraphQL endpoint, REST baseline + OpenAPI paths, scopes, rate-limit policy count). Read-only foundation first.
4. **Server-authoritative:** all key generation, verification, and rate-limit decisions are server-side. React never generates a secret or decides a limit; it renders BFF state and shows the one-time secret.

## Decision (Proposed sub-decisions — NOT delivered)

1. **API docs + external portal / gateway (compose, deferred):** Redocly/Swagger UI for docs; Backstage or Kong OSS for a portal/gateway only if a real need is proven. Complete OpenAPI drift enforcement over request/response **schemas** (today drift covers path+method presence) precedes a published portal.
2. **SDK generation + sandbox/test mode (build/defer):** deferred until the API surface + portal stabilise.
3. Mock providers (WireMock/LocalStack/mock-oidc) remain dev/test only.

### Alternatives considered

1. **Server-generated, hashed, entitlement-gated keys + durable Postgres rate limiter + read-only portal (chosen).** Reuses the proven RLS + write-only-secret + entitlement patterns; fully live-provable; honest about the Redis/SDK/gateway follow-ups.
2. **Redis-backed rate limiting now.** Preferred long-term for sub-second windows + volume, but adds a hard runtime dependency to the decision path before a proven need; deferred to Phase 3.5 behind the port (Redis is already composed).
3. **Paid API gateway (Kong/Apigee) now.** A gateway is operational weight before a proven external-developer need; rejected for the foundation.

### Rejected alternatives (required)

- **Storing plaintext API keys** — rejected: only a salted+peppered hash is stored; the plaintext is shown once.
- **React-generated API keys** — rejected: keys are server-generated and server-authoritative.
- **Unscoped / global keys** — rejected: every key is tenant-scoped (RLS) and entitlement-gated.
- **UI-only rate limiting** — rejected: enforcement is server-side; the UI renders BFF state.
- **Rate limiting without an audit/log signal** — rejected: policy changes are audited; denials are typed + loggable.
- **A paid API-gateway dependency for local proof** — rejected: violates free-local-first (ADR-0053); local proof uses Postgres only.

### Accepted decision

Adopt option 1 for Phase 3. Server-generated hashed keys, durable Postgres rate limiting bridged to the entitlement substrate, and a read-only developer foundation. Redis limiting, SDKs, external portal/gateway, sandbox mode, and full schema-level OpenAPI drift remain Proposed.

## Implementation phases

1. **API-key substrate (Phase 3, done):** migration 025 `api_keys` (RLS), `ApiKeyRepository` port + Postgres adapter, api-key-crypto (scrypt + salt + pepper), api-keys usecase (create/list/revoke/authenticate, entitlement-gated, audited).
2. **Rate limiting (Phase 3, done):** `rate_limit_policies` + `rate_limit_counters` (RLS), `RateLimitRepository` port + Postgres adapter, rate-limits usecase (evaluate/assert/list/set; entitlement before limit; audited set).
3. **Surfaces (Phase 3, done):** BFF routes (+ OpenAPI), `/admin/developer` UI (tenant self-service + operator console).
4. **Provider + portal (Phase 3.5+, future):** Redis limiter behind the port; schema-level drift; external portal/gateway + SDKs if proven.

## Acceptance criteria

- API keys are server-generated, tenant-scoped (RLS), entitlement-gated; only a salted+peppered hash stored; plaintext shown once; the stored hash cannot authenticate as the plaintext; revoked/expired keys denied; no secret in list/read responses; issue + revoke audited.
- Rate limits allow below the limit and deny above it within the window; not-entitled tenants are denied at the entitlement step before counting; policy changes audited; no client-side enforcement.
- `proof:api-keys`, `proof:rate-limits`, `proof:api-key-routes` pass against live Postgres (SKIP honestly if unavailable).

## Proof requirements

`proof:api-keys`, `proof:rate-limits`, `proof:api-key-routes` (live Postgres). In-memory node:test suites (`api-keys`, `rate-limits`) for logic + crypto. No registry status upgrade from a skipped proof.

## Production blockers

- `API_KEY_PEPPER` MUST be set to a strong secret in production (a fixed dev value is used locally only).
- High-volume / sub-second rate limiting should move to Redis (Phase 3.5) behind the port before heavy load.
- A published external developer portal requires schema-level OpenAPI drift enforcement first.

## Consequences

Positive: self-serve programmatic access with a high-integrity secret surface; rate limits reuse the entitlement substrate; fully live-proven; honest follow-up path.

Negative: API keys add a high-value secret surface (mitigated by hashing + pepper + redaction + audit). Postgres fixed-window limiting is not ideal for sub-second/high-volume (mitigated by the Phase-3.5 Redis path).

Neutral / operational: depends on entitlements for the api_access gate and rate-limit entitlement bridge.

## Validation / evidence

Evidence level: High (credential surface). Local proof via the three Phase-3 proofs + node:test suites. Evidence: `docs/evidence/platform/phase-3-api-keys-rate-limits.md`.

## Follow-up actions

Coordinated in `docs/adr/ACTION-REGISTER.md` (ADR-ACT-0257; ADR-ACT-0250 developer-platform discovery).

## References

ADR-0013, ADR-0044, ADR-0051, ADR-0052, ADR-0053, ADR-0058, ADR-0067.

## Notes

Accepted on 2026-06-13 (ADR-ACT-0257) on Matt's authority per the directive. SDK generation, external portal/gateway, sandbox mode, and full schema-level OpenAPI drift are explicitly NOT accepted or delivered here.
