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
