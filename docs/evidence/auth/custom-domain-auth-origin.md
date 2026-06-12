# Custom-Domain Auth Origin Derivation

Action: ADR-ACT-0232 (Source ADR-0029, ADR-0048)
Date: 2026-06-12
Status: locally proven (derivation); real-IdP login on a custom domain remains blocked

## Scope delivered

When a request arrives on an **ACTIVE custom domain** (DNS-ownership verified +
auth-client activated + not disabled, per the `tenant_domains` registry), the BFF auth
flow now derives:

- the correct **tenant realm** (`tenant-{organisationId}`) for `/auth/login`,
  `/auth/callback` token exchange, and `/auth/logout` RP-initiated logout
- the **callback URL on the custom host** (`https://{domain}/auth/callback`) — exactly
  matching the redirect URI that activation wrote to the tenant's Keycloak client
- the **Keycloak public origin on the custom host** (`https://{domain}/kc`), routed by
  the Caddy catch-all vhost (`/kc/realms/*` is public by design — required for login)
- the **error-bounce base** (`/login?authError=…`) on the custom host, keeping Keycloak
  invisible (ADR-ACT-0157) on custom domains too

Trust rule: the `verifiedTenantHost` flag passed to `getAuthCallbackUrl` /
`getKeycloakPublicUrl` is set **only** from `tenantCtx.hostSource === "custom_domain"`,
i.e. a database-verified resolution — never from the raw Host/X-Forwarded-Host header.
Hosts outside the apex allowlist that are NOT active custom domains keep the previous
fallback behaviour (platform realm + env-configured callback), so an attacker-controlled
Host header still cannot mint an OAuth redirect origin.

## Source

- `apps/platform-api/src/server/dependencies.ts` — `getAuthCallbackUrl` /
  `getKeycloakPublicUrl` `verifiedTenantHost` parameter
- `apps/platform-api/src/server/auth.ts` — login / callback / logout threading
- `apps/platform-api/src/server/tenant-resolver.ts` — registry-backed resolution
  (ADR-ACT-0231)

## Matrix (proven by `npm run proof:tenant-custom-domain-auth-origin`)

| Host | Realm in redirect | redirect_uri | Verdict |
| --- | --- | --- | --- |
| active custom domain | `tenant-{orgId}` | `https://{custom}/auth/callback` | locally proven |
| verified-but-inactive custom domain | platform (fallback) | env fallback — custom host NOT trusted | locally proven |
| unknown custom host | platform (fallback) | env fallback | locally proven |
| slug host `{slug}.{apex}` | `tenant-{orgId}` on own origin | own origin | locally proven (pre-existing) |

## Proof

`npm run proof:tenant-custom-domain-auth-origin` — runs the REAL `handleAuthLogin`
handler against live local Postgres + Redis (`make compose-up-default`), seeding registry
permutations directly and asserting the 302 Location URL. All checks PASS. Local-only:
no browser, no IdP, no token exchange.

## Known deferrals / external blockers

- A real brokered login completing on a custom domain requires a real IdP — blocked with
  OIDC login simulation (ADR-ACT-0220; mock-oidc may not substitute).
- Public TLS on custom domains is Cloudflare-terminated — external; `tls_ready` is never
  claimed.

## No-secret guarantee

The proof prints derived URLs only (state/nonce are opaque UUIDs in a redirect that is
never followed; no tokens exist at this stage). No client secret, cookie, or token is
read or printed.

## No-fake-readiness guarantee

The `tenant_auth_custom_domain_callback` capability is registered as `partial` with
readiness `deferred` — derivation is locally proven, but the capability is never
reported ready while real-IdP login is unproven.

## ACTION-REGISTER linkage

ADR-ACT-0232. See also
`docs/evidence/configuration/tenant-custom-domains.md` (lifecycle section) and
`docs/evidence/platform/domain-identity-capability-permutation-review.md` (ADR-ACT-0230).
