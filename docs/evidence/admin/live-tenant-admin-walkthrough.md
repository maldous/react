# Evidence: Live tenant-admin /admin walkthrough

Actions: ADR-ACT-0204 (control plane), ADR-ACT-0205 (per-tenant auth provider config).
Companion to `tenant-administration-control-plane.md` (gate/test evidence). This file is the
**runtime** proof + the repeatable procedure for a logged-in tenant-admin pass.

## Coverage matrix (read this first)

| Control path | How it is proven | Status |
| --- | --- | --- |
| Tenant-aware `GET /api/auth/providers` | Live curl against the running BFF (below) | ✅ live |
| `/auth/login?provider=` guard (valid → 302, invalid/disabled → safe 400) | Live curl (below) | ✅ live |
| Per-tenant provider config read/merge + audit-first write | `auth-provider-config.test.ts` (11 unit tests) | ✅ unit |
| Admin nav permission gating (tenantAdmin vs viewer/none) | `AdminLayout.test.tsx` | ✅ test |
| Members list / invite / role change / remove + last-admin guard | `AdminMembersPage.test.tsx` (MSW e2e through real hooks→client→fetch) + `members.test.ts` (BFF) | ✅ test |
| Feature toggle | `AdminFeaturesPage.test.tsx` + `features.test.ts` | ✅ test |
| Provider mode/allowlist edit + LiveRegion confirm | `AdminAuthPage.test.tsx` | ✅ test |
| Error semantics 401/403/NO_CREDENTIAL/generic | `admin-error.test.tsx` + page tests | ✅ test |
| Full **browser** login → /admin UI click-through on a tenant FQDN | Procedure below | ⏳ manual (steps captured) |

## Live runtime probes (captured 2026-06-11)

Run against the local BFF (`http://localhost:3001`), tenant resolved from the `Host` header.
The seeded tenant `fixture-org` (id `00000000-0000-0000-0000-000000000001`) exists in the DB.

### Tenant-aware provider list (ADR-0037)

```
$ curl -s -H "Host: fixture-org.aldous.info" http://localhost:3001/api/auth/providers
[{"id":"google",...,"mode":"mock"},{"id":"azure",...},{"id":"apple",...},
 {"id":"platform",...,"mode":"internal"}]
```

`fixture-org` has no stored `auth.providers` override, so the list falls back to the environment
default (mock mode, all providers) — the documented precedence (ADR-0037: tenant config overrides
env default; absent ⇒ env default). The endpoint resolves the tenant from the FQDN and returns 200
(no 500), confirming the tenant-aware path is live. The override-reflected case (stored config →
filtered list) is unit-tested in `auth-provider-config.test.ts`.

### `/auth/login` provider enablement guard

```
$ curl -s -o /dev/null -w "%{http_code}" -H "Host: fixture-org.aldous.info" \
    "http://localhost:3001/auth/login?provider=<p>"
provider=platform     -> 302   (valid, internal Keycloak)
provider=google       -> 302   (valid, enabled)
provider=bogus        -> 400   (unknown provider → safe path)
provider=azure evil   -> 400   (injection attempt → safe path)
```

Confirms the guard: valid/enabled providers redirect to Keycloak (302); unknown, malformed, or
not-enabled-for-tenant providers hit the existing safe 400 path (no `kc_idp_hint` injection). A
**tenant-disabled** provider takes the identical `{ ok: false } → 400` branch — exercised by
`auth-provider-config.test.ts` ("third-party rejected when not in the tenant allowlist").

## Authenticated UI walkthrough — procedure (manual)

The `/admin` sections are tenant-scoped (`scope: "tenant"`) and require a logged-in tenant-admin
session on a tenant FQDN. The automated MSW integration tests already drive every section through the
real hooks→client→fetch path; this is the manual browser confirmation.

### Session setup (manual steps)

1. Bring up the identity + web stack for the target env (Keycloak + mock-oidc + BFF + Caddy + SPA):
   `make compose-up-identity ENV=<env> && make compose-up-web ENV=<env>` and `make seed-idps ENV=<env>`.
2. Ensure a tenant exists and has a **tenant-admin** member. `fixture-org` is seeded; otherwise
   provision one (`POST /api/admin/tenants` as system-admin) and add a tenant-admin membership.
   Local shortcut: run the BFF with `LOCAL_FIXTURE_SESSION=tenant-admin` (`npm run api:start:admin`),
   which yields a tenant-admin actor (real `resolvePermissions`) — note the section APIs still require
   the request to arrive on the tenant FQDN, so use the tenant host.
3. Reach the tenant FQDN (`<slug>.aldous.info`, or `<slug>.localhost` via `/etc/hosts` + Caddy).

### Steps to confirm

1. Open `https://<slug>.aldous.info/admin` → the **/admin overview** renders with nav.
2. As **tenant-admin**, confirm nav shows Overview, Members, Authentication, Features (Logs only if
   `platform.logs.read`). As **viewer/member**, confirm `/admin/members`, `/admin/auth`, `/admin/features`
   render `ForbiddenState` (route `RequirePermission`), and those nav items are hidden.
3. **Members** → list renders; **Invite** (email + role) → member appears/pending; **change role** via
   the inline select; **Remove** → confirm dialog → removed. Confirm the last-admin guard (server)
   rejects removing/demoting the only admin.
4. **Features** → toggle a flag → LiveRegion announces "Feature updated".
5. **Authentication → Providers** → change mode / disable one provider → LiveRegion announces saved.
6. Reload `GET /api/auth/providers` on that FQDN → reflects the new tenant config.
7. `GET /auth/login?provider=<disabled>` on that FQDN → safe 400 (see live probe above).
8. Confirm audit events written: query the audit store for `auth_settings.providers.changed`,
   `feature.toggled`, `member.*` for the tenant — each mutation is audit-first (emit before write).

## Why a fully-scripted browser login was not run here

Driving Keycloak login as a tenant-admin on a tenant FQDN needs a seeded tenant-admin browser session
and the full identity stack on resolvable tenant hostnames — beyond this hardening pass. The backend
behaviours are unit-tested, the UI behaviours are MSW-integration-tested, and the two unauthenticated
runtime paths (provider list, login guard) are verified live above. The remaining manual browser
confirmation is the procedure in this file.

## Audit-visibility verification (ADR-0040)

As a tenant admin, after each mutation confirm the matching contextual audit panel updates:

1. Members → expand a member → "Recent activity": edit the username, then disable/enable the member,
   then change the role — each appears as a `member.username_changed` / `member.status_changed` /
   `member.role_changed` row (actor + timestamp). (Invite/resend are keyed by email — deferred from the
   per-member panel.)
2. `/admin/config` → change a value and reset it → "Recent configuration changes" shows
   `config.value_changed` / `config.value_cleared`.
3. `/admin/auth` → Providers → change the mode/allowlist → "Recent provider changes" shows
   `auth_settings.providers.changed`.
4. Sign in as a viewer/member: the audit panels return 403 (no `tenant.audit.read`).
5. Confirm no cross-tenant events appear (the query is tenant-scoped from the session).

These behaviours are covered by `apps/platform-api/tests/unit/audit.test.ts` (isolation, forbidden,
filters, redaction) and `apps/react-enterprise-app/src/features/admin/__tests__/AuditTrailPanel.test.tsx`
(render/empty/error/forbidden/axe); the steps above are the live confirmation.
