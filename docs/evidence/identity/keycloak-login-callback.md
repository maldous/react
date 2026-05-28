# Evidence: ADR-ACT-0119 — Real Keycloak Login Callback

**Date:** 2026-05-29
**Status:** Done
**Action:** ADR-ACT-0119
**ADR Refs:** ADR-0021, ADR-0022

## Summary

Implements real OAuth 2.0 Authorization Code + PKCE login flow through the
platform-api BFF, connecting Keycloak identity to a server-side Redis session.
The React app receives only a safe `SessionActor` shape from `/api/session` —
no access tokens, no Keycloak claim objects, no client secrets.

## Architecture shape (ADR-0022)

```text
React app → GET /auth/login
              ↓ PKCE state stored in Redis (5 min TTL)
              ↓ 302 → Keycloak /authorize (PKCE S256)
            Keycloak authenticates user
              ↓ 302 → GET /auth/callback?code=...&state=...
              ↓ state validated (consume-once, prevents replay)
              ↓ code exchanged for tokens (server-side, client_secret)
              ↓ GET /userinfo with access_token
              ↓ identity mapped via mapKeycloakClaims
              ↓ User + ExternalIdentity looked up / created in Postgres
              ↓ Membership + role resolved
              ↓ permissions resolved via resolvePermissions (domain-identity)
              ↓ session created in Redis
              ↓ HTTP-only cookie set → 302 → React app
React app → GET /api/session → safe SessionActor JSON
```

## New and modified files

| File | Change |
| ---- | ------ |
| `packages/domain-identity/src/index.ts` | Added `resolvePermissions(role)` — single source of truth for role→permission mapping |
| `packages/adapters-redis/src/index.ts` | Implemented `RedisSessionStore` + `RedisAuthStateStore` + `createRedisClient` |
| `packages/adapters-keycloak/src/index.ts` | Implemented `exchangeCodeForTokens`, `getUserInfo`, `buildAuthorizationUrl` |
| `apps/platform-api/src/ports/identity-repository.ts` | `IdentityRepository` port (findExternalIdentity, createUserAndExternalIdentity, findMembershipByUser) |
| `apps/platform-api/src/adapters/postgres-identity-repository.ts` | Postgres implementation; createUserAndExternalIdentity is transactional |
| `apps/platform-api/src/usecases/auth.ts` | `resolveSessionFromIdentity`, `readSession`, `destroySession` — pure DI |
| `apps/platform-api/src/server/auth.ts` | `handleAuthLogin`, `handleAuthCallback`, `handleAuthLogout`, `parseSessionCookie` |
| `apps/platform-api/src/server/routes.ts` | Added GET /auth/login, GET /auth/callback, POST /auth/logout; updated /api/session |
| `apps/platform-api/src/server/pipeline.ts` | Auth resolution: fixture → real cookie → 401 |
| `apps/platform-api/src/server/dependencies.ts` | Redis client, session store, auth-state store, identity repo, Keycloak config |

## Security decisions

| Decision | Detail |
| -------- | ------ |
| No access tokens in session | Redis session stores only userId, tenantId, roles, permissions, displayName |
| HTTP-only cookie | `platform_session` cookie has `HttpOnly; SameSite=Strict; Path=/` |
| Secure flag | `false` for local dev (`http://localhost`); `true` when `SESSION_COOKIE_SECURE=true` or `NODE_ENV=production` |
| PKCE S256 | code_verifier generated with 32 random bytes; challenge = SHA-256(verifier) |
| State one-time use | `getDel` (atomic) prevents state replay attacks |
| returnTo sanitisation | Only relative paths (`/...`) accepted; absolute URLs silently fall back to `/` |
| No JWT verification | Token exchange is server-to-server with confidential client — userinfo response trusted by provenance |
| Keycloak SDK boundary | All Keycloak types remain in `packages/adapters-keycloak`; no SDK in domain/feature/UI |
| Pre-auth nonce cookie | `auth_state_token` HttpOnly SameSite=Lax cookie binds login flow to initiating user-agent; verified in callback |
| No email-only account merge | `createUserAndExternalIdentity` uses `ON CONFLICT (email) DO NOTHING`; throws `EMAIL_ALREADY_REGISTERED` if email taken — no silent account hijack |
| `email_verified` required | `mapKeycloakClaims` returns null if `email` absent or `email_verified !== true`; callback responds 401 |

## Security hardening (post-implementation)

Applied after initial implementation following automated security review:

| Severity | Finding | Fix |
| -------- | ------- | --- |
| CRITICAL | Identity federation / account takeover via email-only linking | `ON CONFLICT (email) DO NOTHING` + `EMAIL_ALREADY_REGISTERED` error |
| HIGH | OAuth CSRF / session fixation | Pre-auth nonce in `auth_state_token` cookie (SameSite=Lax), verified in callback, cleared after use |
| HIGH | Identity spoofing via unverified / absent email | `mapKeycloakClaims` returns null if `email_verified !== true`; `preferred_username` not used for email |

## Fixture session preservation (ADR-ACT-0008)

`LOCAL_FIXTURE_SESSION` env var takes precedence in both `/api/session` and
the pipeline auth resolution. Tier 1 fixture-based E2E tests (`npm run test:e2e`)
are fully unaffected — they continue to use deterministic fixture sessions
without a real Keycloak connection.

## Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `KEYCLOAK_URL` | `http://localhost:8080` | Keycloak base URL |
| `KEYCLOAK_REALM` | `platform` | Realm name |
| `KEYCLOAK_CLIENT_ID` | `platform-api` | BFF confidential client ID |
| `KEYCLOAK_CLIENT_SECRET` | `""` | BFF client secret — never committed; set in env |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `PLATFORM_API_URL` | `http://localhost:3001` | Used to build callback URL |
| `APP_BASE_URL` | `http://localhost:5173` | React app base URL for post-auth redirect |
| `SESSION_TTL_SECONDS` | `1800` | Session duration in seconds |
| `SESSION_COOKIE_SECURE` | `false` | Set `true` in production; `false` for localhost |

## Tests added

| Suite | Count | What it proves |
| ----- | ----- | -------------- |
| `domain-identity.test.ts` (resolvePermissions) | 6 | Role→permission mapping for all 5 roles |
| `adapters-redis.test.ts` | 11 | RedisSessionStore + RedisAuthStateStore with fake Redis |
| `adapters-keycloak.test.ts` | 15 | Token exchange, userinfo, URL builder, mocked fetch |
| `postgres-identity-repository.test.ts` | 6 | findExternalIdentity, create, idempotency, membership |
| `auth-usecase.test.ts` | 8 | resolveSessionFromIdentity + readSession + destroySession (fake deps) |
| `auth-routes.test.ts` | 12 | Login redirect, callback error paths, logout, fixture regression |

## Deferrals

| Item | Reason |
| ---- | ------ |
| Keycloak global logout (end_session endpoint) | Session cookie is cleared; full SSO logout follow-up |
| Full E2E with real Keycloak login | Requires live Keycloak + test users; set `KEYCLOAK_CLIENT_SECRET` and run against `docker compose --profile identity up -d keycloak` |
| Staging/production Keycloak provisioning | Blocked until AWS infra and Terraform secrets management |

## Constraints honoured

- React app remains browser-only; no token storage in browser JS
- No Keycloak SDK imports outside `packages/adapters-keycloak`
- Domain packages do not import HTTP, Redis, session, or Keycloak types
- API permission guards remain the authoritative enforcement point
- `LOCAL_FIXTURE_SESSION` fixture sessions work unchanged
- `make pre-slice-gate` passes
- `make check` passes; all architecture gate violations: 0
- ADR-ACT-0008 remains accepted and unchanged
