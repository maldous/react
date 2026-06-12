# Domain Identity & Capability Permutation Review

Status: source-derived review (Phase 1 of the foundation completion programme)
Action: ADR-ACT-0230
Date: 2026-06-12
Author: platform engineering (AI-assisted, reviewed against source)

This review enumerates every host identity, actor identity, permission mode,
routed service, admin surface, and platform-capability permutation, derived
from **source inspection only** — not from ADR aspiration. Each claim cites
the file that proves it. Gaps feed the implementation slices tracked as
ADR-ACT-0231..0234.

Sources inspected:

```text
apps/platform-api/src/server/tenant-resolver.ts
apps/platform-api/src/server/pipeline.ts
apps/platform-api/src/server/forward-auth.ts
apps/platform-api/src/server/auth.ts
apps/platform-api/src/server/dependencies.ts (host/origin helpers)
apps/platform-api/src/server/routes.ts (full route table)
apps/platform-api/src/usecases/tenant-domains.ts
apps/platform-api/src/usecases/vanity-domain-challenge.ts
apps/platform-api/src/usecases/vanity-domain.ts
apps/platform-api/src/usecases/capability-registry.ts
packages/domain-identity/src/index.ts
packages/contracts-admin/src/index.ts (domain section)
docker/caddy/Caddyfile
apps/platform-api/src/db/migrations/014-vanity-domain-challenges.sql
apps/react-enterprise-app/src/routes/admin/* + features/admin-domains/*
docs/adr/ACTION-REGISTER.md
package.json proof scripts
```

## Headline findings (pre-implementation)

1. **Custom domains are never host identities.** `resolveTenantFromRequest`
   (tenant-resolver.ts) resolves slug subdomains only. A DNS-verified,
   auth-client-activated custom domain still resolves to `null` tenant, so
   every tenant-scoped route 403s and `/auth/login` falls back to the platform
   realm on a custom host.
2. **Custom domains can never be auth-callback origins.** `isAllowedHost`
   (dependencies.ts:270) accepts loopback + apex + `*.apex` only. The Keycloak
   client *does* get `https://{domain}/auth/callback` added by
   `addVanityDomain`, but the BFF will never derive that callback URL — the
   two halves of the feature do not meet.
3. **`consumed_at` is overloaded.** It means both "challenge superseded"
   (createDomainChallenge invalidation) and "domain added to auth client"
   (consumeChallenge). There is no explicit lifecycle store; routing/TLS/
   canonical states have no persistence at all.
4. **Forward-auth allows clickthroughs Caddy never routes, and routes one it
   should not.** `TENANT_ADMIN_RESOURCES` = {keycloak, mailpit, sentry}
   (forward-auth.ts:70). The Caddyfile tenant block routes `/kc/*` and
   `/mailpit/*` but **not** `/sentry/*` (apex-only by comment). And the tenant
   `/mailpit/*` route reverse-proxies the **shared, unfiltered** Mailpit UI —
   the "tenant-domain-filtered email view" safety claim in the comment is not
   implemented. A tenant-admin on their own slug can read all tenants' mail.
5. **Global-scope routes accept unknown/reserved subdomain hosts.** Pipeline
   `scope: "global"` only checks `fqdnTenant === null` (pipeline.ts:459).
   `unknown.aldous.info` and reserved subdomains resolve no tenant, match the
   Caddy `*.aldous.info` wildcard, share the `Domain=aldous.info` cookie — so
   global-only APIs are callable from non-apex hosts.
6. **forward-auth has a drifted slug extractor.** Its private
   `extractSlugFromHost` (forward-auth.ts:102) does not strip ports and does
   not regex-validate the slug, unlike the pipeline resolver (ADR-ACT-0225
   port fix landed only in tenant-resolver.ts).
7. **Orphaned tests.** `tests/unit/tenant-resolver.test.ts` and
   `tests/unit/forward-auth.test.ts` exist but are absent from the explicit
   `test:platform-api` list in package.json — they run nowhere.
8. **Groups and sub-organisations have API but no UI.** Routes
   `/api/org/groups*` and `/api/org/sub-organisations*` exist with full
   permission/UMA metadata; `apps/react-enterprise-app/src/routes/admin/` has
   no groups/suborgs route, and the capability registry does not list them.
9. **No delegated roles exist.** Tenant roles are exactly
   `tenant-admin | manager | member | viewer` (domain-identity). All
   `tenant.domains.*`, `tenant.auth.settings.*`, etc. land on tenant-admin
   only. Domain-reader/manager etc. are unrealised.
10. **Domain mutations are split across two permissions.** Challenge create/
    verify exist both under `tenant.domains.write` (`/api/org/domains*`) and
    under `tenant.auth.settings.write` (`/api/auth/settings/domains*`);
    auth-client **activation** exists only on the auth-settings surface, so a
    hypothetical domain-only delegate could verify but never activate.

---

## Matrix A: host identity matrix

| Host identity | Example | Source of truth | Resolver support | Caddy/proxy support | BFF support | Auth login/callback | Cookie behaviour | Admin UI | Readiness vocabulary | Proof script | Gap | Required functionality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apex | `aldous.info`, `test.localhost` | `APEX_DOMAIN` env; `isGlobalHost` | resolves to `null` tenant (correct) | apex vhost block (Caddyfile:101) | global routes allowed; tenant routes 403 | platform realm; callback on apex host | host or `SESSION_COOKIE_DOMAIN` scoped | super-admin SPA | n/a | proof:platform-services | none | — |
| slug tenant domain | `acme.aldous.info` | `organisations.slug` (DB-verified) | `extractSlugFromHost` + DB lookup | `*.aldous.info` wildcard block (Caddyfile:277) | tenant routes allowed for own-tenant session | tenant realm `tenant-{orgId}`; host-derived callback | shared when `Domain=aldous.info` | tenant SPA + /admin | verified (ownership n/a) | proof:tenant-domains-routing | none | — |
| local slug tenant domain | `acme.test.localhost:8081` | same, `APEX_DOMAIN=test.localhost` | port stripped (ADR-ACT-0225) | `*.test.localhost` block | same as slug | same; `schemeFor` loopback→http | host-scoped, non-Secure | same | routing_local_active | proof:tenant-domains-routing | none | — |
| verified custom domain | `app.mycorp.example` (TXT-verified) | `vanity_domain_challenges.verified_at` | **none — resolves null** | **no matching vhost** | **tenant routes 403** | **falls back to platform realm / env callback** | cookie set for custom host never issued | listed in /admin/domains (status only) | `verified` | proof:tenant-domains | resolver, vhost, auth origin | first-class host identity (ADR-ACT-0231) |
| auth-client-active custom domain | same + KC redirect/web-origin added | `consumed_at` (overloaded) + KC client state | **none** | **none** | **none** | KC would accept the redirect URI, but BFF never derives it | n/a | not distinguishable from verified | none (routing_unknown) | none | full chain missing | resolve tenant; derive callback; explicit `auth_client_status` (ADR-ACT-0231/0232) |
| locally routed custom domain | custom host → local Caddy | n/a | n/a | **no catch-all vhost** | n/a | n/a | n/a | n/a | routing_local_active (vocabulary exists, never set for custom) | none | Caddy catch-all + probe | catch-all vhost + local probe + persisted state (ADR-ACT-0232) |
| publicly routed custom domain | custom host via Cloudflare | external DNS + Cloudflare | n/a | external | n/a | n/a | n/a | n/a | routing_active (reserved) | none | external | **blocked** (needs public DNS/CDN); keep deferred |
| canonical custom domain | one per tenant | **no model** | n/a | n/a | n/a | n/a | n/a | none | none | none | entire concept | canonical flag + guards + no-redirect default (ADR-ACT-0232) |
| reserved subdomain | `kc.aldous.info`, `admin.aldous.info` | `RESERVED_SLUGS` (domain-identity) | resolves null (correct) | matches `*.aldous.info` wildcard → serves tenant SPA | tenant routes 403; **global routes allowed** | platform realm fallback | shared cookie | tenant SPA shell renders | n/a | none | global-scope leak (finding 5) | global routes must reject `*.apex` subdomains (ADR-ACT-0231) |
| service/tool subdomain | (path-based, not subdomain) | Caddyfile path handles | n/a | `/kc/*`, `/mailpit/*`, `/sonar/*`… | forward-auth | n/a | session cookie read by forward-auth | clickthrough links | n/a | none | sentry/mailpit mismatch (finding 4) | reconcile policy ↔ Caddyfile (ADR-ACT-0233) |
| malformed host | `bad host!`, empty | regex in extractor | resolves null (correct) | no vhost match | 403/global-less | platform fallback | none | n/a | n/a | none | no classifier; behaviour implicit | explicit classification + tests (ADR-ACT-0231) |
| unknown host | `evil.example` direct | n/a | resolves null | no vhost match (connection-level default) | tenant routes 403 | `isAllowedHost` false → env-fallback callback (correct) | none | n/a | n/a | none | none (correct by accident) | covered by classifier tests |
| forwarded host | `X-Forwarded-Host: acme.aldous.info` | Caddy `trusted_proxies` (Cloudflare + private) | preferred over Host; comma-split first | header_up in forward_auth snippet | same trust assumption | host derived the same way | same | n/a | n/a | tenant-domains-routing exercises it | none | document trust boundary (this review) |
| host with port | `acme.test.localhost:8081` | port-strip in resolver/isGlobalHost | yes (pipeline) / **no (forward-auth copy)** | Caddy `{host}` excludes port | yes | yes | yes | n/a | n/a | proof:tenant-domains-routing | forward-auth drift (finding 6) | unify extractors (ADR-ACT-0231) |
| internal host/path | `/internal/auth/forward` | Caddyfile omission + `X-Internal-Secret` | n/a | not in any public vhost | constant-time secret check; fail-closed in prod | n/a | cookie copied by Caddy only | n/a | n/a | unit tests | none | — |

## Matrix B: actor × host matrix

Legend: ✔ allowed, ✖ denied, n/a not applicable. Pipeline rules:
`canAccessTenantFqdn` (pipeline.ts:124), scope enforcement (pipeline.ts:454),
forward-auth `checkResourceAccess` (forward-auth.ts:211).

| Actor | apex | tenant slug host | local tenant host | verified custom host | activated custom host | canonical host | tool route on apex | tool route on tenant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unauthenticated | ✔ public routes only (`/api/theme`, `/auth/*`, health) | same | same | ✖ today (no tenant ⇒ tenant login broken); ✔ public after ADR-ACT-0231 | same | n/a (no model) | ✖ 401 (forward-auth) | ✖ 401 |
| viewer | ✔ session/global-public; no admin perms | ✔ own tenant only (`organisationId` match) | ✔ | ✖ today / ✔ own tenant after 0231 | same | n/a | ✖ 403 | ✖ 403 |
| member | as viewer | ✔ own tenant | ✔ | as viewer | same | n/a | ✖ | ✖ |
| manager | as viewer + member.invite legacy perms (no routes enforce them) | ✔ own tenant | ✔ | as viewer | same | n/a | ✖ | ✖ |
| tenant-admin | ✔ (but tenant-scoped routes 403 on apex: `scope:"tenant"`) | ✔ full tenant admin surface | ✔ | ✖ today / ✔ after 0231 | ✔ after 0231 | n/a | ✖ (not in SYSTEM_ADMIN_RESOURCES) | ✔ own slug only, keycloak today (+mailpit — being revoked, finding 4) |
| delegated domain reader/writer | **role does not exist** — falls to tenant-admin | — | — | — | — | — | — | — |
| delegated auth reader/writer | **does not exist** | — | — | — | — | — | — | — |
| delegated integration writer | **does not exist** | — | — | — | — | — | — | — |
| system-admin (apex) | ✔ global routes (`scope:"global"`) | ✖ **blocked** without support mode (canAccessTenantFqdn) | ✖ | ✖ | ✖ | ✖ | ✔ all SYSTEM_ADMIN_RESOURCES | ✖ (no tenant-admin role) |
| system-admin tenant FQDN, no support mode | n/a | ✖ 403 (tested: support-mode.test.ts) | ✖ | ✖ | ✖ | ✖ | n/a | ✖ |
| system-admin support mode, target tenant | n/a | ✔ only `effectiveOrganisationId` | ✔ | ✔ after 0231 (same predicate) | ✔ | ✔ | n/a | ✖ (forward-auth has no support-mode branch — documented limitation) |
| system-admin support mode, wrong tenant | n/a | ✖ | ✖ | ✖ | ✖ | ✖ | n/a | ✖ |
| fixture actor | fixture mode skips FQDN resolution + scope checks entirely (pipeline.ts:276) — deterministic E2E only, never production | | | | | | forward-auth honours fixture roles | |
| expired/missing session | 401 on `requiresAuth` routes everywhere | | | | | | 401 | 401 |
| session for different tenant | ✖ canAccessTenantFqdn | ✖ | ✖ | ✖ | ✖ | ✖ | n/a | ✖ ownSlug≠requestedSlug |
| disabled member | session resolution: memberships filtered by status at login (members-v2); existing session until TTL | | | | | | | |
| invited member | no session until first login resolves invited→active | | | | | | | |

## Matrix C: capability read/write matrix

Route table source: `apps/platform-api/src/server/routes.ts`. All tenant
routes: `scope:"tenant"` (reject apex); all admin/tenants routes:
`scope:"global"` (reject tenant FQDN). UMA resource#scope listed as `res#scope`.

| Capability | Read | Write | Test/probe | Activate/deactivate | Rotate/repair | Route scope | UI | API | Proof | Missing permutations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tenant lifecycle | platform.tenants.read `admin:tenants#read` | platform.tenants.create `#create` | — | — | credential attach/rotate/repair (`/api/admin/tenants/*auth-settings-credential*`) | global | /admin (sysadmin) | ✔ | proof:auth-credential-lifecycle | delete/export not implemented |
| members | tenant.members.read `organisation:members#read` | invite/update_role/delete + username/status/resend | — | enable/disable via status | — | tenant | /admin/members | ✔ | unit+MSW | — |
| groups | tenant.groups.read | create/update/delete | — | — | — | tenant | **none** | ✔ | unit only | UI absent; registry absent (finding 8) |
| sub-organisations | tenant.suborgs.read | create/update/delete (+ global `POST /api/admin/sub-tenants` quirk: `scope:"tenant"`) | — | — | — | tenant | **none** | ✔ | unit only | UI absent; registry absent |
| auth provider allowlist | tenant.auth.settings.read `admin:auth#read` | …write `#write` | — | — | — | tenant | /admin/auth | ✔ | proof:auth-settings | — |
| IdP definitions | same | same (create/update/delete, redacted DTO) | test-connection (write) | enable/disable via update | — | tenant | /admin/auth | ✔ | proof:auth-idps | — |
| OIDC discovery | — | tenant.auth.settings.write (`/idps/oidc/discover`) | — | — | — | tenant | /admin/auth | ✔ | proof:auth-oidc-enterprise | — |
| OIDC mapping | read | write (`/idps/:alias/mapping`) | — | — | — | tenant | /admin/auth | ✔ | unit | brokered-login exercise blocked (ADR-ACT-0220) |
| MFA policy | read | write | — | — | — | tenant | /admin/auth | ✔ | proof:auth-settings | — |
| session policy | read | write | — | — | — | tenant | /admin/auth | ✔ | proof:auth-settings | — |
| sysadmin brokering | read | write | — | — | — | tenant | /admin/auth | ✔ | unit | — |
| resource policies | read | write | — | — | — | tenant | /admin/auth | ✔ | unit | — |
| domains | tenant.domains.read `admin:domains#read` | tenant.domains.write (create challenge, delete) | verify (write) | **auth-client activation only via tenant.auth.settings.write** (finding 10) | — | tenant | /admin/domains | ✔ | proof:tenant-domains | activation under domains.write; routing probe; canonical; lifecycle store (ADR-ACT-0232) |
| domain DNS verification | — | tenant.domains.write (`/:domain/verify`) | — | — | — | tenant | verify button | ✔ | proof:tenant-domains | dns_mismatch surfaced; ok |
| domain auth-client activation | — | **tenant.auth.settings.write** (`POST /api/auth/settings/domains`) | — | — | — | tenant | **none** | ✔ | none | move under domains surface (0232) |
| domain routing | — | — | **none** | — | — | — | status badge (always routing_unknown from API) | readiness only | proof:tenant-domains-routing (script-only; not persisted) | probe endpoint + persisted `routing_local_active` (0232) |
| domain TLS | — | — | none | — | — | — | badge tls_unknown | readiness only | none | local TLS honestly impossible (Caddy web profile is HTTP-only; Cloudflare terminates) — stays deferred |
| canonical domain cutover | — | **none** | — | — | — | — | none | none | none | full slice (0232), local-only label |
| branding/theme | public `/api/theme` (host-keyed) + tenant.config.* | tenant.config.write | — | — | — | tenant (+public) | /admin/config | ✔ | routing proof uses it | — |
| feature flags | tenant.features.read | tenant.features.update | — | — | — | tenant | /admin/features | ✔ | unit | — |
| config registry | tenant.config.read | tenant.config.write (+delete override) | — | — | — | tenant | /admin/config | ✔ | unit | — |
| email sender | tenant.email.settings.read `admin:email#read` | …write | `/email-sender/test` (write) | enable/disable via settings | secret write-only | tenant | /admin/email | ✔ | proof:email-sender | — |
| storage | tenant.storage.read `admin:storage#read` | — | `/storage/probe` (tenant.storage.write) | — | — | tenant | /admin/storage | ✔ | proof:tenant-storage | provisioning/IAM deferred (honest partial) |
| observability | tenant.observability.read | — | readiness probes inline | — | — | tenant | /admin/observability | ✔ | proof:tenant-observability | traces/dashboards deferred |
| webhooks | tenant.webhooks.read | tenant.webhooks.write (CRUD) | `/webhooks/:id/test` | enable/disable via update | rotate-secret (reveal-once) | tenant | /admin/webhooks | ✔ | proof:webhooks, proof:webhook-worker | — |
| webhook redrive | — | tenant.webhooks.write (single + bulk dead) | — | — | — | tenant | /admin/webhooks | ✔ | proof:webhook-redrive | — |
| audit | tenant.audit.read `organisation:audit#read` | append-only (server) | — | — | — | tenant | contextual panels | ✔ | unit | — |
| logs | platform.logs.read (static only, no UMA) | — | — | — | — | **global** | /admin/logs | ✔ | substrate | tenant-scoped log read = observability readiness only |
| service clickthrough | role-based (forward-auth) | n/a | — | — | — | host-based | header links | forward-auth | **none** | policy module + reconciliation + proof (0233) |
| support mode | platform.admin.access `platform:support#enter` | session-creating POST | — | — | — | global | sysadmin UI | ✔ | support-mode.test.ts | forward-auth has no support-mode branch (documented) |
| backup/restore | scripts only (`scripts/backup/*.sh`), guarded restore | — | — | — | — | n/a | none (deliberate) | n/a | proof:backup-local | — (ADR-ACT-0229) |
| platform operations | tenant.platform.read `admin:platform#read` | — | bounded health probes | — | — | tenant | /admin/platform | ✔ | proof:platform-services | — |

## Matrix D: service clickthrough matrix

Source: `SYSTEM_ADMIN_RESOURCES` / `TENANT_ADMIN_RESOURCES`
(forward-auth.ts:48/70) vs Caddyfile handles (apex block :101, tenant block :277).

| Service | Apex route | Tenant route | Tenant-safe? | Global-only? | forward-auth resource | Caddy route | Required permission/role | Isolation guarantee | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Keycloak | `/kc/*` (realms+resources public; console gated) | `/kc/*` same | conditionally — console requires a KC admin account; platform session gate is additive; realm endpoints are public by design (needed for login) | no | `admin:keycloak` (both sets) | ✔ both blocks | system-admin OR tenant-admin own slug | KC's own authn + realm permissions, NOT the proxy | keep tenant-scoped; document invariant + test (0233) |
| Mailpit | `/mailpit/*` | `/mailpit/*` **unfiltered** | **NO** — shared inbox, no tenant filter exists in Mailpit | should be | `admin:mailpit` in BOTH sets | ✔ both blocks | currently tenant-admin allowed | **none — false comment claim** | **revoke tenant access**: remove from TENANT_ADMIN_RESOURCES + remove tenant Caddy route (0233) |
| Sentry | `/sentry/*` | none | n/a | yes (per Caddyfile comment) | `admin:sentry` in BOTH sets | apex only | system-admin | shared instance, no per-tenant org | **remove from TENANT_ADMIN_RESOURCES** — dead grant (0233) |
| Grafana | `/grafana/*` | none | no (all tenants' logs) | yes | `admin:grafana` (system only) | apex only | system-admin | none | consistent — keep global-only |
| MinIO console | `/minio/*` | none | no (all buckets) | yes | `admin:minio` (system only) | apex only | system-admin | none | consistent |
| pgAdmin | `/pgadmin/*` | none | no (raw SQL) | yes | `admin:pgadmin` (system only) | apex only | system-admin | none | consistent |
| SonarQube | `/sonar/*` | none | no | yes | `admin:sonarqube` (system only) | apex only | system-admin | none | consistent |
| ClickHouse | `/clickhouse/*` | none | no (no partitioning) | yes | `admin:clickhouse` (system only) | apex only | system-admin | none | consistent |
| LocalStack | `/localstack/*` | none | no | yes | `admin:localstack` (system only) | apex only | system-admin | none | consistent |
| WireMock | none (NOT_EXPOSED) | none | n/a | n/a | absent (intentional) | none | direct port only (dev) | n/a | consistent |
| Tilt | none (cannot path-proxy) | none | n/a | n/a | `admin:tilt` (system only, unused by Caddy) | none | direct :10350 | n/a | resource defined but unroutable — document |
| Caddy app (SPA) | catch-all | catch-all | yes (public shell) | no | none | ✔ | none | BFF enforces data authority | consistent |
| platform API | `/api/*`, `/auth/*`, health | same | yes | no | none (pipeline enforces) | ✔ | per-route | pipeline FQDN/session | consistent |

## Matrix E: readiness/status matrix

| Area | Statuses (source) | Meaning | Upgrades it | Must never upgrade it | Local-only labels | UI label |
| --- | --- | --- | --- | --- | --- | --- |
| domains (ownership) | pending_dns / dns_mismatch / verified / degraded (contracts-admin:545) | DNS-TXT ownership proof | live `resolveTxt` match (verifyDomainChallenge) | DB write without DNS check | n/a | /admin/domains badge |
| domains (auth client) | implicit via consumed_at — **no explicit status** | KC redirect/web-origin added | consumeChallenge after KC PUT | challenge supersede (currently conflated!) | n/a | **none — gap (0232)** |
| routing | routing_unknown / routing_local_active / routing_active | local = proxy + tenant context proven; public = reserved | proof:tenant-domains-routing (script; **not persisted**) | DB state, auth-client activation | routing_local_active explicitly local | badge (always unknown today) |
| TLS | tls_unknown / tls_local_ready / tls_ready | issuance proof | none possible locally (web Caddy HTTP-only; Cloudflare terminates) | inference from routing | tls_local_ready label exists, never set (honest) | badge |
| auth credential | configured / missing_credential / invalid_credential / forbidden_realm_operation / realm_unreachable | per-tenant service-account probe | live token round-trip | stored-but-unvalidated secret | n/a | /admin/readiness |
| IdP config | idp-count readiness | ≥1 IdP configured | live realm list | — | n/a | /admin/readiness |
| OIDC mapping | partial/deferred | configured ≠ exercised | real brokered login (blocked — ADR-ACT-0220) | mock-oidc substitute (explicitly disallowed) | n/a | /admin/readiness |
| email | configured / missing_sender / missing_credential / invalid_credential / provider_unreachable | sender + credential proven | live SMTP/Brevo probe + test send | stored config alone | local = Mailpit provider | /admin/email |
| storage | configured / not_configured / provider_unreachable / isolation_failed / unknown | write→read→delete round-trip + prefix guard | live probe | endpoint env alone | local = MinIO | /admin/storage |
| observability | configured / not_configured / provider_unreachable / degraded | bounded Loki/Grafana/Sentry/OTel reachability | live bounded GETs | static config | local endpoints | /admin/observability |
| webhooks | configured / no_subscriptions / has_dead_deliveries / degraded | subscription + delivery state | DB counts (real) | — | n/a | /admin/webhooks |
| service health | ok/degraded/unreachable per service (SERVICE_REGISTRY, 15 services) | bounded live probes | live probe | registry presence | local stack | /admin/platform |
| worker health | heartbeat registry | worker liveness | heartbeat row freshness | process existence | n/a | /admin/platform |
| backup | proof:backup-local | dump+restore integrity round-trip | live pg_dump/restore in dev/test | script existence | guarded local-only | none |
| seed/demo | make seed-demo | deterministic fixtures | script run | — | local-only | none |

Aggregate effect: only `required` capabilities feed the overall tenant
readiness (capability-registry.ts:398, worst-status-wins). Domains, storage,
observability, webhooks are non-required, so their incomplete states cannot
block tenant readiness — correct.

## Decisions feeding Phase 2/3

1. **ADR-ACT-0231 — host identity + custom-domain resolution.** Pure
   `classifyHostIdentity` in `@platform/domain-identity`; tenant resolver
   gains an active-custom-domain lookup (new `tenant_domains` registry);
   forward-auth reuses the shared extractor; pipeline `scope:"global"`
   hardened to reject `*.apex` subdomain hosts; orphaned resolver/forward-auth
   tests wired into `test:platform-api`.
2. **ADR-ACT-0232 — explicit domain lifecycle.** Migration 021
   `tenant_domains` (ownership/auth-client/routing/TLS/canonical columns +
   honest backfill from `vanity_domain_challenges`, history preserved);
   activation + local routing probe + canonical set/unset under
   `tenant.domains.write`; Caddy catch-all vhost so active custom domains are
   locally routable; contracts/OpenAPI/i18n/UI extension; auth-origin
   derivation for custom domains (login/callback realm + redirect URI), full
   login proof remains blocked on real IdPs.
3. **ADR-ACT-0233 — clickthrough policy reconciliation.** Pure policy module
   as single source of truth; revoke tenant mailpit + sentry grants; Caddyfile
   tenant `/mailpit/*` route removed; reconciliation test parses the Caddyfile
   against the policy; proof script.
4. **ADR-ACT-0234 — honesty alignment for unrealised permutations.**
   Capability registry rows for groups/suborgs (partial: API-only),
   host-identity resolution, custom-domain auth callback, canonical domain,
   clickthrough policy; delegated roles documented as deferred (no new roles
   without an ADR).

## Guarantees

- No secret values inspected or reproduced in this document.
- No readiness status was upgraded by this review; all status claims above are
  descriptions of existing source behaviour.
- External blockers: public DNS/TLS/routing for custom domains (Cloudflare),
  real-IdP login simulation (ADR-ACT-0220) — remain blocked.
