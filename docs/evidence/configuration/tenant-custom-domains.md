# Tenant Custom Domains + DNS/TLS Readiness — Evidence (ADR-0048 / ADR-ACT-0217)

Date: 2026-06-12. Owner: Architecture owner / technical lead.
AI assistance: Claude Opus 4.8 (implementation), human-reviewed.

## Scope delivered

A readiness-aware custom-domain layer over the existing vanity-domain plumbing
(ADR-ACT-0162 add/remove + ADR-ACT-0188 DNS-TXT ownership challenge):

- **Contracts** (`@platform/contracts-admin`, strict/no-passthrough):
  `TenantDomainSummary`, `TenantDomainListResponse`, `CreateTenantDomainRequest`,
  `TenantDomainVerificationResponse`, `TenantDomainReadinessResponse`, with honest
  status enums (per-domain `pending_dns | dns_mismatch | verified | degraded`; TLS
  `tls_unknown | tls_ready`; routing `routing_unknown | routing_active`; aggregate
  `no_domains | pending_verification | verified | degraded`).
- **Read/readiness use case** (`usecases/tenant-domains.ts`): pure `mapDomainRows`
  (collapses challenge rows → one honest summary per domain) and `computeDomainReadiness`,
  with thin `listTenantDomains` / `getTenantDomainReadiness` IO wrappers over
  `vanity_domain_challenges` (migration 014 — no new table).
- **API** (tenant-scoped, FQDN/session): `GET /api/org/domains`,
  `GET /api/org/domains/readiness`, `POST /api/org/domains`,
  `POST /api/org/domains/:domain/verify`, `DELETE /api/org/domains/:domain`. Mutations
  delegate to the existing `createDomainChallenge` / `verifyDomainChallenge` /
  `removeVanityDomain` use cases; all are audit-first.
- **Permissions**: new `tenant.domains.read` / `tenant.domains.write` on `tenant-admin`.
- **UI**: a new `/admin/domains` surface + nav entry + `/admin/readiness` link — list
  with status/TLS/routing badges, add-domain form, displayed DNS TXT record, per-row
  verify + remove, readiness banner, read-only without write permission, axe-clean.

## Decisions

- The verification `token` is a PUBLIC DNS value (published as a TXT record), so it is
  returned and displayed; it is not a secret.
- A domain is `verified` only when DNS-TXT ownership was actually proven; `routing` is
  `routing_active` only when the verified challenge was consumed (recorded as added to
  the tenant auth client), else `routing_unknown`; `tls` is always `tls_unknown` — no
  TLS check is performed and none is claimed.
- The capability is **partial**, not implemented: DNS-ownership + auth-client wiring are
  real; TLS issuance and live end-to-end routing/canonical cutover are deferred.
- Tenant authority is FQDN/session only; `CreateTenantDomainRequest` carries no tenant id.
- Additive only: the older `/api/auth/settings/domains*` routes are untouched.

## Tests run (with proof layer)

- `node:test` (platform-api) — `tenant-domains.test.ts` (21 assertions across
  `mapDomainRows` + `computeDomainReadiness`): pending→pending_dns, verified→verified,
  verified+consumed→routing_active, TLS never claimed, multi-row collapse (verified
  wins), stable ordering; readiness no_domains / pending_verification / verified.
- `node:test` — `capability-registry.test.ts`: `tenant_domains` is `partial`, its
  readiness reflects the new `domainReadiness` signal honestly, optional (non-blocking);
  the never-fake-readiness guard still pins the remaining deferred set (storage,
  oidc_login_simulation, oidc_claim_mapping, oidc_group_role_mapping).
- `node:test` — `vanity-domain-challenge.test.ts` (existing): DNS-TXT verify branches
  (fake resolver) — found/mismatch/expired/consumed lifecycle.
- Vitest (frontend) — `AdminDomainsPage.test.tsx` (6, MSW-proven): list + readiness
  render, add domain shows TXT record + announces, verify announces, read-only without
  write permission, axe accessibility.
- OpenAPI drift: 78 routes match `docs/api/openapi.json` (5 new paths).
- Full suites green: `test:platform-api` 472, `test:frontend:run` 152.

## Runtime proof (executed)

`apps/platform-api/scripts/tenant-domains-runtime-proof.ts`
(`npm run proof:tenant-domains`). Exercises the full lifecycle against LIVE Postgres.

```bash
make compose-up-default
npm run proof:tenant-domains
```

Executed output (local Postgres, dev profile, 2026-06-12):

```text
# Tenant custom domains runtime proof

PASS  pending challenge → pending_dns / routing_unknown / tls_unknown
PASS  no domains → no_domains readiness
PASS  challenge created with a public TXT token
PASS  DNS-TXT verification succeeds (stub resolver)
PASS  listed as verified after ownership proof
PASS  readiness aggregates to verified — verified
PASS  proof challenge rows cleaned up

# ALL CHECKS PASSED
```

## Proven live vs unit/MSW only

- Live-proven (against Postgres): the create-challenge → verify → list → aggregate
  readiness SQL + classification lifecycle, plus cleanup.
- Unit-proven (`node:test`): the pure row→summary mapping and readiness aggregation
  (all branches), and the DNS-TXT verify branches via the resolver port.
- MSW-proven (frontend): the `/admin/domains` list/add/verify/read-only flows + axe.
- NOT proven (honestly deferred): resolving a real public DNS TXT record (no
  controllable public domain in the local stack — the resolver port is stubbed in the
  proof), TLS issuance, and live end-to-end routing/canonical cutover.

## Capability map changes

`tenant_domains`: `deferred` → **partial**, `adminRoute: /admin/domains`,
`requiredPermission: tenant.domains.read`, `readinessKind: "tenant-domains"` (a new
signal `domainReadiness` gathered in `GET /api/org/readiness`). Optional → never blocks
overall readiness.

## Local routing proof (ADR-ACT-0225)

Local tenant-FQDN routing through the **web-profile Caddy** is now live-proven.

- Status vocabulary (honest, local vs public): routing `routing_unknown` /
  `routing_local_active` (local proxy proven) / `routing_active` (public, deferred);
  tls `tls_unknown` / `tls_local_ready` / `tls_ready` (both deferred — see below).
- **Resolver fix:** `extractSlugFromHost` now strips a `:port` from the Host (it
  previously matched only port-less hosts, so tenant resolution silently fell back to
  apex on non-standard local/test ports like `:8081`). Production (`:80`/`:443` via
  Cloudflare, no port) is unaffected. Unit-tested.
- `mapDomainRows` no longer infers `routing_active` from auth-client membership
  (consumed) — that is not proof traffic routes. The DB-derived `routing` is always
  `routing_unknown`; `routing_local_active` is established only by the live proof.

Runtime proof — `npm run proof:tenant-domains-routing` (requires
`make compose-up-web ENV=test`; SKIPs honestly if the local Caddy is down). It seeds a
temp tenant + per-tenant schema + a UNIQUE theme marker, creates + DNS-TXT-verifies a
domain challenge for the tenant FQDN, then GETs the tenant FQDN `/api/theme` THROUGH
Caddy and asserts the unique marker is returned (apex returns the default):

```text
# Tenant domains local routing runtime proof

PASS  local Caddy reachable @ http://test.localhost:8081
PASS  seeded temp tenant + schema + unique theme marker — routing-proof-….test.localhost
PASS  domain ownership verified via DNS-TXT (existing proof path)
PASS  tenant FQDN routed to the CORRECT tenant context through local Caddy — tenant=ROUTING-PROOF-… apex=Enterprise Platform
PASS  classified routing_local_active (local routing proven)
PASS  tls stays tls_unknown locally (no local Caddy TLS to claim tls_local_ready)
INFO  public routing_active + public tls_ready remain DEFERRED — not provable locally

# ALL CHECKS PASSED
```

- **TLS:** the web-profile Caddy listens on `:80` (HTTP) — Cloudflare terminates public
  TLS in production. There is no local Caddy internal-CA TLS to exercise, so
  `tls_local_ready` is **not** claimed and `tls` stays `tls_unknown` locally.

## Known deferrals

- **Public** `routing_active` + `tls_ready` — public DNS, Cloudflare TLS issuance, and
  canonical-domain cutover; not provable locally.
- **Custom (vanity) domain** local routing through Caddy — the web Caddy wildcards match
  `*.{apex}` (tenant slug FQDNs), not arbitrary customer domains; a custom domain would
  need an explicit Caddy route + hosts entry (production cutover territory).
- TLS-issuance readiness probe and DNS-provider automation — out of scope.

## No-secret guarantee

No secret is involved in this slice. The verification token is a public DNS value.
The realm-admin credential used by `DELETE` (to mutate the auth client) is read via the
existing `PostgresTenantCredentialStore` and never returned, logged, or printed.

## No-fake-readiness guarantee

`verified` requires a real DNS-TXT match; `routing_local_active` requires a live proof
that the tenant FQDN reaches the correct tenant context through the local proxy; public
`routing_active` / `tls_ready` and `tls_local_ready` are never claimed without a real
check (none exists locally). Asserted by `tenant-domains.test.ts`,
`capability-registry.test.ts`, and `proof:tenant-domains-routing`.

## ACTION-REGISTER linkage

ADR-ACT-0217 (Source ADR-0048). Evidence: this file.

---

## ADR-ACT-0232 — explicit domain lifecycle, activation under tenant.domains.write, canonical, local custom-domain routing

Date: 2026-06-12. This section supersedes the "custom domain local routing" deferral
above — that permutation is now implemented and locally proven.

### Scope delivered

- **Lifecycle registry** (`public.tenant_domains`, migration 021): explicit
  `ownership_status` / `auth_client_status` / `routing_status` / `tls_status` /
  `canonical` / `redirect_policy` columns with proven-at timestamps. Honest backfill from
  `vanity_domain_challenges` (history preserved; routing/TLS/canonical never backfilled;
  orphan challenge rows — pre-FK local databases — excluded via organisations join).
  Partial unique index on enabled `domain` = cross-tenant takeover guard; partial unique
  index per organisation = ≤1 canonical domain.
- **Ports/adapters (hexagonal):** `TenantDomainRegistryPort` →
  `PostgresTenantDomainRegistry`; `LocalRoutingProbePort` → `CaddyLocalRoutingProbe`
  (node:http with explicit Host override — undici fetch silently drops `host` headers);
  `AuthClientDomainPort` wraps the existing vanity-domain Keycloak plumbing. Pure guards
  (`canActivateAuthClient`, `canSetCanonical`) and audit-first operations in
  `usecases/tenant-domain-lifecycle.ts`.
- **Routes (all `tenant.domains.write`, scope tenant, `admin:domains#write`):**
  `POST /api/org/domains/:domain/activate` (requires DNS-verified ownership; consumes the
  challenge — restoring `consumed_at`'s documented meaning),
  `POST .../deactivate`, `POST .../probe-routing-local`,
  `POST`/`DELETE .../canonical`. `DELETE /api/org/domains/:domain` now needs the tenant
  credential only when the auth client is actually active.
- **Ownership-enforcement fix:** the legacy `POST /api/auth/settings/domains` added a
  domain to the Keycloak client **without any DNS-ownership check** (documented in
  migration 014 but never enforced — `checkDomainOwnership`/`consumeChallenge` had no
  callers). Both surfaces now enforce verified ownership before activation.
- **Custom-domain auth origin:** `getAuthCallbackUrl`/`getKeycloakPublicUrl` accept a
  `verifiedTenantHost` flag set ONLY when the tenant was resolved from the
  `tenant_domains` registry (ACTIVE custom domain). Login, callback, logout, and the
  error-bounce base all honour it; raw headers alone never confer origin trust.
- **Caddy catch-all vhost** (`http://`, lowest precedence): active custom domains get the
  tenant-app surface (kc realms, /api, /auth, SPA). Tool clickthroughs (`/kc` console,
  `/mailpit`) are deliberately NOT exposed on custom domains. Unregistered hosts get the
  public shell + `tenant: null` only.
- **Public `GET /api/host-identity`:** host classification + resolved tenant slug/
  hostSource (public values only) — consumed by the routing probe and proofs.
- **Admin UI `/admin/domains`:** auth-client + canonical columns; guard-mirrored actions
  (verify / activate / probe local routing / set–unset canonical / deactivate / remove);
  hidden (not disabled) when unsupported or read-only; canonical labelled local-only
  (`no_redirect`). MSW handlers + 4 new UI tests.
- **Contracts/OpenAPI/i18n:** extended strict `TenantDomainSummary` (+5 schemas), 6 new
  OpenAPI paths (drift green), new i18n keys + 4 capability-registry entries
  (`tenant_host_identity_resolution` implemented; `tenant_domain_activation` implemented;
  `tenant_canonical_domain` partial/deferred; `tenant_auth_custom_domain_callback`
  partial/deferred — never claimed ready).

### Tests run

`npm run test:platform-api` (617 pass, includes new `tenant-domain-lifecycle.test.ts` —
audit→KC→registry ordering, failed-KC leaves inactive, probe-only upgrades, canonical
guards), `npm run test:frontend:run` (173 pass), `npm run tsc:check`,
`npm run openapi:drift`, i18n + frontend conventions, `make check`.

### Proof output (live, local)

- `proof:tenant-domains-routing` — extended: **ACTIVE custom domain routes to the
  CORRECT tenant via the Caddy catch-all** (`hostSource: custom_domain`); unregistered
  custom host resolves NO tenant. Requires `make compose-up-web ENV=test`.
- `proof:tenant-domain-canonical` — guard chain (not_verified → auth_client_inactive →
  routing_not_proven), canonical set/replace/unset, deactivation clears canonical+routing.
- `proof:tenant-custom-domain-auth-origin` — REAL `handleAuthLogin` against live
  Postgres+Redis: active custom domain derives the tenant realm on the custom `/kc`
  origin with `redirect_uri=https://{custom}/auth/callback`; verified-but-inactive and
  unknown hosts fall back and never claim the callback.
- All pre-existing proofs re-run green (auth-oidc-enterprise, email-sender,
  tenant-domains, tenant-storage, tenant-observability, webhooks, webhook-worker,
  webhook-redrive).

### Live vs unit/MSW

Routing/auth-origin/canonical proofs are **live local** (Postgres, Redis, Caddy web
profile, containerised platform-api). UI actions are MSW-proven. Public DNS / public
TLS / public routing / real-IdP login on a custom domain remain **blocked/deferred**
(external dependencies) and are never reported as ready.

### No-secret / no-fake-readiness guarantees

Unchanged from above and extended: activation marks `active` only after the Keycloak
client mutation succeeded; `routing_local_active` is written only by a live probe and is
labelled local; `tls_*` is never set locally; canonical never alters redirect behaviour
(`no_redirect`). Audit metadata carries domain names only (public DNS values).

### ACTION-REGISTER linkage

ADR-ACT-0232 (Source ADR-0048, ADR-0029). Evidence: this section +
`docs/evidence/auth/custom-domain-auth-origin.md`.
