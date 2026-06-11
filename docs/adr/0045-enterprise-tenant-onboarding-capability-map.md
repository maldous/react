# ADR-0045: Enterprise Tenant Onboarding and Control-Plane Capability Map

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

The platform now has a substantial writable control plane — tenant admin, identity & membership v2,
config registry, contextual audit, auth-settings credential provisioning + lifecycle, and writable
Session/MFA/IdP settings (ADR-0036–0044), with live Keycloak proofs for realm writes and IdP CRUD.

What is missing is a **map of the whole**: there is no single place that says _which_ enterprise
capabilities exist, which are implemented vs partial vs deferred, and — for a given tenant — whether
each is actually configured. Onboarding a tenant to "fully usable" is implicit tribal knowledge.

This ADR defines a **Capability Registry** and a **tenant readiness model**, and begins implementing a
**`/admin/readiness` setup surface** that drives a tenant from created → fully configured against a
visible checklist. The platform standard is **OIDC-first**; SAML is explicitly out of scope (it may be
a future adapter and appears in the map only as a deferred capability).

---

## Decision

### Capability Registry

A server-owned registry enumerates every enterprise control-plane capability. Each entry declares:

- `key`, `category`
- `adminRoute` (where it is managed, or null)
- `requiredPermission` (to manage it)
- `implementationStatus`: **implemented | partial | deferred**
- `required`: whether the tenant is unusable without it
- how its readiness is determined (see below)
- the audit actions, contracts/ports/adapters, and evidence file it maps to (documented in the
  capability-map evidence file rather than the runtime DTO)

Capabilities covered: identity, auth providers, session policy, MFA policy, IdP configuration, tenant
domains, email/sender config, branding, feature/config registry, member administration,
roles/permissions, audit, storage, integrations/webhooks, observability/readiness — plus **OIDC
enterprise** sub-capabilities (discovery URL, issuer validation, JWKS validation, claim mapping,
group/role mapping, test connection, callback URL display, login simulation), all **deferred** but
**visible** in the map.

### Tenant readiness model

Per-capability readiness uses: **ready | incomplete | blocked | degraded | unknown | deferred**.
The **overall** tenant readiness aggregates the `required` capabilities: **ready | incomplete |
blocked | degraded | unknown** (the worst required status wins; `blocked` > `degraded` > `incomplete`

> `unknown` > `ready`). `deferred`/non-required capabilities never block the overall status.

### No faked readiness

A capability is only reported `ready` when the BFF can justify it through one of:

1. a **live check** — e.g. the auth-settings credential readiness probe (ADR-0041), an active
   tenant-admin count, a tenant auth-providers resolution, an IdP count;
2. a **documented local invariant** — e.g. the config/branding registry always supplies defaults, so
   config is available by construction; the durable `audit_events` store is always present; the
   roles/permissions model and member-administration routes exist by construction.

Anything not yet verifiable is reported `deferred` (capability not checkable yet) or `unknown` (check
could not run) — never `ready`. This is enforced by the registry's per-capability readiness kind.

### Endpoint + surface

`GET /api/org/readiness` (tenant scope, `tenant.admin.access`) returns the capability list with each
capability's `implementationStatus` + tenant `readiness` + `adminRoute`, plus the aggregated overall
status. Tenant context comes from the **FQDN/session**, never the request body. The SPA renders a
`/admin/readiness` setup surface: grouped capability cards with readiness badges, links to the relevant
admin screen, and explicit missing-action messages.

---

## Consequences

### Positive

- The enterprise control plane is now self-describing: gaps are visible and prioritised, and a tenant
  can be driven to "fully configured" from inside the app against a real checklist.
- Readiness is honest — backed by live checks or documented invariants, never assumed.

### Negative / Limitations

- Several capabilities (storage, email/sender, integrations/webhooks, observability, all OIDC
  enterprise sub-capabilities) are visible but `deferred` — the map shows them as not-yet-checkable
  rather than pretending. The first slice implements the registry + readiness aggregation + surface;
  deepening individual checks is follow-up work the map itself prioritises.

### Deferred

- SAML IdP management; per-capability deep checks for storage/email/integrations/observability; the
  OIDC enterprise sub-capabilities (discovery/JWKS/claim+role mapping/test-connection/login
  simulation); a guided step-by-step wizard (this slice ships a checklist, not a wizard).

---

## Related ADRs

- ADR-0036 (control plane), ADR-0037 (providers), ADR-0038 (identity v2), ADR-0039 (config registry),
  ADR-0040 (audit), ADR-0041–0044 (auth-settings credential + Session/MFA/IdP + lifecycle),
  ADR-0026 (i18n), ADR-0029 (tenant isolation).
- Implementation: ADR-ACT-0213.
