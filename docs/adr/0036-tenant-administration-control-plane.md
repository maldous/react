# ADR-0036: Tenant Administration Control Plane

## Status

Accepted

## Date

2026-06-11

## Decision owner

Architecture owner / technical lead

---

## Context

The platform backend already exposes a complete tenant-administration REST surface — members
(`/api/org/members`), feature flags (`/api/org/features`), groups, sub-organisations, and the auth
settings family (`/api/auth/settings/{idps,mfa,session,domains,...}`) — all enforced with FQDN tenant
scoping, UMA + static-RBAC permission checks, Row-Level Security, and audit (ADR-0029, ADR-0030,
ADR-0022). `@platform/domain-identity` models User/Organisation/Membership/roles and resolves the
permission bundles surfaced to the SPA via `GET /api/session`.

What is missing is the **operator-facing control plane in the React app**. The only in-app admin route
is `/admin/logs` (ADR-0035). There is no `/admin` shell, no navigation, and no UI for the management
capabilities the API already supports. Tenant admins currently have no first-class place in the product
to administer their tenant; the next phase of generic application features should not be built before
this foundation exists.

---

## Decision

Build a React **tenant administration control plane** mounted at `/admin`, consuming the existing BFF
endpoints. The first slice delivers a responsive admin shell plus three sections — **Members**,
**Authentication**, and **Features** — with the remaining sections (groups, sub-organisations, domains,
system-admin global tooling) registered as follow-up actions.

### Boundaries (how it fits existing decisions)

- **Data access is REST-over-BFF.** ADR-0013 keeps GraphQL as the primary client API and REST as the
  supplementary BFF surface. Admin management operations are direct, audited CRUD that map 1:1 to domain
  mutations, so they use the existing REST endpoints via the established `admin-logs` pattern
  (`features/admin-logs/admin-logs-client.ts` + a TanStack Query hook). The SPA never bypasses the BFF
  and never calls Keycloak/Postgres directly.
- **The AppShell owns the single `<main id="main-content">` landmark.** The admin shell renders _inside_
  it as a layout region with its own `<nav>`; it does not introduce a second main (enforced by
  `validate-frontend-conventions`).
- **Permissions are UX-only in React; the API is the enforcement point** (ADR-0022). Routes gate on
  `useSession().hasPermission(...)` via `RequirePermission`; the BFF re-checks every request.
- **Tenant context comes from the FQDN** (ADR-0029/0030), never from the client. Admin sections are
  tenant-scoped (`scope: "tenant"`).

### Shape

- A pathless-parent `/admin` layout route (`AdminLayout`) under the `_authenticated` layout, gated by
  `tenant.admin.access` (system-admin also permitted). It renders a permission-filtered navigation and
  an `<Outlet/>`.
- Child routes `/admin` (overview), `/admin/members`, `/admin/auth`, `/admin/features`, and the existing
  `/admin/logs` re-parented under the layout.
- DTOs shared between BFF and SPA are typed in a new contract package, `@platform/contracts-admin`
  (zod), following the `contracts-organisation` precedent.

### Mobile / Capacitor

The shell is responsive and Capacitor-aware (ADR-0027): a sidebar on `lg+`, a horizontally scrollable
nav row on small screens; safe-area utilities (`styles/globals.css`); no hover-only affordances; touch
targets ≥ 40px; `DataTable` scrolls horizontally on narrow viewports.

---

## Consequences

### Positive

- Tenant admins get a first-class in-product control plane over capabilities the API already supports.
- Reuses existing endpoints, permissions, audit, and RLS — no new enforcement surface.
- Establishes the reusable admin shell + section pattern for the deferred sections.

### Negative / Limitations

- Admin REST DTO shapes now live in `@platform/contracts-admin`; the BFF adopts them incrementally
  (request validation + the new provider endpoints) rather than in a single rewrite.
- Adds a second navigation surface (admin nav) that must be kept responsive and accessible.

### Auth settings editability boundary (intentional, this slice)

The Authentication section's **Providers** tab is writable (per-tenant mode + provider allowlist,
ADR-0037). The **Identity providers**, **MFA**, and **Session** tabs are intentionally **read-only**
for now: editing them mutates the tenant's Keycloak realm through a per-tenant service-account
credential, and per-tenant credential provisioning is deferred (ADR-0037, "out of scope"). Until that
lands, the read tabs surface current realm state and show a "not configured" state when the tenant has
no credential (503 `NO_CREDENTIAL`). Making IdPs/MFA/Session writable is a follow-up slice gated on
credential provisioning — not a gap in this one.

### Deferred (follow-up actions)

- Sections: Groups, Sub-organisations, custom Domains, sysadmin-brokering, resource-policies.
- Editable IdPs/MFA/Session (gated on per-tenant credential provisioning, ADR-0037).
- System-admin **global** tooling: tenant provisioning (`/api/admin/tenants`), support sessions.
- Tenant identity & membership v2 (ADR-ACT-0206).
- These are tracked under the ACTION-REGISTER, not built in this slice.

---

## Related ADRs

- ADR-0013: Client-facing API boundary (GraphQL primary, REST supplementary).
- ADR-0022: Authentication, session, and SSO boundary (session actor, permissions).
- ADR-0029: Multi-tenant isolation boundaries (FQDN scoping, RLS).
- ADR-0030: Dynamic authorisation and tenant admin self-service (auth settings API).
- ADR-0019/ADR-0035: AppShell delivery pattern / admin log search (`/admin/logs`).
- ADR-0037: Per-tenant authentication provider configuration (companion to this slice).
- Implementation: ADR-ACT-0204.
