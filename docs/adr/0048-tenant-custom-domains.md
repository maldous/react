# ADR-0048: Tenant Custom Domains + DNS/TLS Readiness

## Status

Accepted

## Date

2026-06-12

## Decision owner

Architecture owner / technical lead

## Consulted

ADR-0029/0030 (tenant resolution + BFF boundary, FQDN routing), ADR-0040 (audit
trail), ADR-0045 (capability map), ADR-0046 (OIDC enterprise hardening), ADR-0047
(email sender — the sibling slice this mirrors). Builds directly on the existing
vanity-domain plumbing: ADR-ACT-0162 (runtime redirect_uri add/remove on the
tenant auth client) and ADR-ACT-0188 (DNS-TXT ownership challenge + verification).
Claude Opus 4.8 (implementation assistance, human-reviewed).

## Context

After OIDC enterprise hardening (ADR-0046) the ADR-0045 capability map still listed
`tenant_domains` as **deferred**, even though real lower-level plumbing already
existed: a tenant could already prove ownership of a domain via a DNS-TXT challenge
(ADR-ACT-0188) and have it added to / removed from its Keycloak BFF client
redirect*uris (ADR-ACT-0162). What was missing was the \_readiness-aware* layer: no
way to **list** a tenant's domains with honest status, no aggregate readiness
signal, no capability-map promotion, and no admin surface. The readiness model also
needed to be explicit about what is and is not proven — DNS ownership is provable;
TLS issuance and live end-to-end routing are not, in this stack.

Constraints and risks:

- Tenant authority must come from FQDN/session, never the request body (ADR-0029/0030).
- Readiness must stay honest (ADR-0045): a domain is `verified` only when DNS-TXT
  ownership was actually proven; TLS issuance and live routing must never be claimed
  without a real check.
- Do not implement production DNS automation or certificate issuance — none exists.
- Reuse the proven challenge/verify/add/remove use cases; do not duplicate them.

## Stakeholder concerns

- Product: a tenant can add a custom domain, see the DNS record to publish, verify it,
  and see where it stands.
- Engineering: reuse the ADR-ACT-0162/0188 use cases; add only the read/readiness/admin layers.
- Security: the verification token is a PUBLIC DNS value (not a secret); tenant authority
  is server-side only; mutations are audit-first.
- Operations: classified, bounded DNS verification; no certificate or routing claims that
  cannot be backed by a check.
- Compliance/governance: capability map + ACTION-REGISTER + evidence in lock-step.

## Decision drivers

- Honesty of readiness over feature breadth.
- Reuse of the existing vanity-domain plumbing; additive, lowest-risk change.
- A real, repeatable local proof (live Postgres lifecycle).
- Strict, no-passthrough contracts; no body-supplied tenant authority.

## Options considered

### Option A: Read + readiness + admin layer over the existing plumbing (chosen)

Add strict contracts, a pure read/readiness use case over the existing
`vanity_domain_challenges` store, a dedicated `/api/org/domains` surface (permission
`tenant.domains.*`) that delegates mutations to the ADR-ACT-0162/0188 use cases, a
capability-map promotion to **partial**, and a minimal `/admin/domains` surface.

Pros: reuses proven code; honest readiness; no new data store; small surface.
Cons: two route prefixes reach the same domain plumbing (the older
`/api/auth/settings/domains*` stays for backward compatibility).
Risks: none beyond the already-bounded outbound DNS lookup.

### Option B: New end-to-end domain subsystem (new table, new verification)

Pros: single owner. Cons: duplicates working DNS-TXT + redirect-uri plumbing;
higher risk; rejected.

### Option C: Promote the capability without a readiness signal or admin surface

Pros: trivial. Cons: dishonest — capability map would claim more than is checkable;
no operator-visible state; rejected.

## Decision

Adopt **Option A**. Add `GET /api/org/domains` (list with honest per-domain
verification/TLS/routing status), `GET /api/org/domains/readiness`,
`POST /api/org/domains` (create ownership challenge), `POST /api/org/domains/:domain/verify`,
and `DELETE /api/org/domains/:domain`, gated by new `tenant.domains.read` /
`tenant.domains.write` permissions on the tenant-admin role. Mutations delegate to
the existing challenge/verify/add/remove use cases and are audit-first; tenant
authority is FQDN/session only. The capability map promotes `tenant_domains` from
`deferred` to **partial**: DNS-ownership proof + auth-client add/remove are
implemented; TLS issuance and live end-to-end routing/canonical cutover are NOT
verified and are honestly deferred. A new `/admin/domains` surface lists domains,
adds a domain, shows the DNS TXT record, verifies, and reports readiness.

## Rationale

The verification `token` is a value the tenant publishes publicly in DNS, so returning
and displaying it carries no secret risk. A domain reaches `verified` only via a real
DNS-TXT match; `routing` is `routing_active` only when the domain was recorded as added
to the tenant auth client (a persisted fact), else `routing_unknown`; `tls` is always
`tls_unknown` because no TLS check is performed. Readiness therefore never overstates
what is true.

## Consequences

Positive: tenants can manage + prove custom domains with an honest readiness signal;
capability map reflects real status; no new data store or data-access bypass.
Negative: the older `/api/auth/settings/domains*` routes remain alongside the new
`/api/org/domains` surface (both delegate to the same use cases).
Neutral: a `proof:tenant-domains` script exercises the challenge→verify→list→readiness
lifecycle against live Postgres (DNS resolver stubbed at its port).

## AI-assistance record

AI used: Yes. Tool/model: Claude Opus 4.8 (1M context), Claude Code. Scope:
implementation, tests, runtime proof, this ADR. Human review: required before merge.
Validation: gates + runtime proof in the evidence bundle.

## Validation / evidence

Evidence level: High. Evidence: `docs/evidence/configuration/tenant-custom-domains.md`.

## Impacted areas

- Architecture: new BFF read/readiness use case + dedicated `/api/org/domains` routes;
  reuses the existing vanity-domain use cases.
- Data: no new table (reuses `vanity_domain_challenges`, migration 014).
- API: `GET /api/org/domains`, `GET /api/org/domains/readiness`,
  `POST /api/org/domains`, `POST /api/org/domains/:domain/verify`,
  `DELETE /api/org/domains/:domain`.
- Security: server-side tenant authority; audit-first mutations; public DNS token only.
- Testing: backend unit (pure mapping + readiness) + frontend MSW/axe + OpenAPI drift +
  live-Postgres runtime proof.
- UX: new `/admin/domains` surface + nav + readiness link.
- Documentation: capability map, OpenAPI, i18n, CODEMAPS, ACTION-REGISTER.

## Follow-up actions

Tracked in:

```text
docs/adr/ACTION-REGISTER.md
```

ADR-ACT-0217 covers this slice. Future actions: TLS-issuance readiness probe,
live end-to-end routing/canonical-domain verification, and DNS-provider automation.

## Review date

2026-12-12

## Supersedes

None.

## Superseded by

None.

## References

- ADR-0029 multi-tenant isolation + FQDN routing
- ADR-0045 enterprise capability map
- ADR-0047 tenant email sender configuration (sibling slice)
- ADR-ACT-0162 runtime vanity-domain redirect_uri management
- ADR-ACT-0188 vanity-domain DNS-TXT ownership challenge

## Notes

Per-domain statuses: `pending_dns`, `dns_mismatch`, `verified`, `degraded`. TLS:
`tls_unknown` (always, this pass) / `tls_ready` (reserved). Routing: `routing_unknown`
/ `routing_active` (added to the tenant auth client). Aggregate readiness: `no_domains`,
`pending_verification`, `verified`, `degraded`. TLS issuance and live routing are not
checked and are never claimed — readiness stays honest.
