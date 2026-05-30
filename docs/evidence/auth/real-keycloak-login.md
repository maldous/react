# Evidence: Real Keycloak Browser Login

**Action:** ADR-ACT-0155 (Real aldous.info Keycloak browser login E2E)
**ADR:** ADR-0022 (authentication, session, SSO boundary), ADR-0029 (FQDN routing)
**Date:** 2026-05-29

## What is covered

The `e2e/real-auth/` test suite under `playwright.real-auth.config.ts` provides
end-to-end evidence of the platform's authentication flow against the local
`http://aldous.info` stack:

- Real PKCE Authorization Code flow via Keycloak (no fixture session bypass)
- HTTP-only session cookie set by platform-api BFF
- `/api/session` returning a real actor from Redis session store
- Session invalidation on logout
- Caddy forward_auth protecting admin tool routes
- Platform-branded login entry page (Option B)
- Super-global landing page with session actor display and tool links

## Scope

| Layer | Proof |
| --- | --- |
| Browser ? Caddy | Caddy serves aldous.info on port 80; virtual host routing confirmed |
| Caddy ? Keycloak | `/kc/*` proxied to keycloak:8080; Keycloak login form rendered |
| Keycloak ? platform-api | PKCE code exchange at `/auth/callback` succeeds |
| platform-api ? Redis | Session stored with roles/permissions; visible in `/api/session` |
| Cookie | `platform_session` not accessible via `document.cookie` (HttpOnly) |
| Logout | `/auth/logout` POST clears session; `/api/session` returns 401 |
| forward_auth | Unauthenticated tool route returns 401/403; authenticated system-admin passes |

## Not covered (deferred)

| Gap | Action |
| --- | --- |
| Keycloak login page theming | ADR-ACT-0156 |
| OIDC/SAML broker login | ADR-ACT-0157 |
| MFA-required flow | ADR-ACT-0158 |
| Disabled/unverified user | ADR-ACT-0159 |
| Expired session recovery | ADR-ACT-0160 |

## How to run

See `docs/local-development/real-login-e2e.md` for full setup instructions.

```sh
KEYCLOAK_TEST_USERNAME=sysadmin@aldous.info \
KEYCLOAK_TEST_PASSWORD=password \
npx playwright test --config playwright.real-auth.config.ts
```

## Runtime requirements

- `/etc/hosts`: `127.0.0.1 aldous.info`
- `make compose-up-default && make compose-up-identity && make keycloak-provision`
- `PLATFORM_API_URL=http://aldous.info APP_BASE_URL=http://aldous.info make compose-up-web`
- `KEYCLOAK_CLIENT_SECRET` must match the value in `local.tfvars`

## ADR-0022 invariants verified

- Raw tokens are not stored in the browser (no `accessToken` in `/api/session` response)
- Session cookie is HTTP-only (not accessible via `document.cookie`)
- BFF owns the token exchange (Keycloak callback goes to `/auth/callback`, not browser)
- PKCE prevents code interception attacks
