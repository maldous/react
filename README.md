# Enterprise React Platform

![Tests](https://img.shields.io/badge/tests-1271%2B%20passing-brightgreen)
![ADRs](https://img.shields.io/badge/ADRs-41%20accepted-blue)
![Environments](https://img.shields.io/badge/environments-4%20isolated-blueviolet)
![Packages](https://img.shields.io/badge/packages-governed-orange)
![WCAG](https://img.shields.io/badge/WCAG-2.2%20AA-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)

> **A production-grade multi-tenant SaaS foundation — governed, tested, observable, and secure before product features are layered on top.**

Most React projects start at the screen. Structure is retrofitted once the product has hardened around shortcuts. The cost of that retrofit is high: security vulnerabilities that cannot be removed without rebuilding, test suites that mock away the bugs, component trees that own things they were never supposed to own.

This repository takes the opposite path. Architecture decisions come first. Every structural choice is written as an ADR, enforced by tooling, tested with evidence, and then surfaced through working platform capabilities.

The result is no longer just a React shell. It is a governed enterprise application substrate: tenant provisioning, identity, admin control, auth configuration, contextual audit, typed configuration, and production-style observability are all present before the first generic product module is added.

---

## What is built

| Layer                      | Technology / Pattern                                      | Role                                                                                                                   |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **React SPA**              | React 19, TanStack Router, TanStack Query, React Aria     | Typed routes, server-state cache, accessible admin and app surfaces                                                    |
| **Admin control plane**    | `/admin` shell, permission-gated routes, design system    | Members, Auth, Features, Config, Email, Domains, Storage, Observability, Webhooks, Platform ops, Readiness, Logs/audit |
| **BFF / API**              | Node.js, TypeScript, route pipeline, use cases            | Session resolution, tenant context, permission checks, orchestration                                                   |
| **Identity**               | Keycloak per-tenant realms, PKCE/OIDC, UMA, BFF sessions  | SSO, realm isolation, policy-backed authorisation                                                                      |
| **Tenant identity model**  | Global users + tenant-scoped memberships                  | Username, role, status, last login, external identities per tenant                                                     |
| **Configuration registry** | Typed registry definitions + effective tenant values      | Governed feature/config settings with audit-first mutation                                                             |
| **Database**               | PostgreSQL schema-per-tenant + RLS, Redis, ClickHouse     | Transactional data, sessions, analytics                                                                                |
| **Storage**                | MinIO / S3-compatible                                     | Object storage with per-tenant prefix isolation                                                                        |
| **Email**                  | Brevo / SMTP, Mailpit locally                             | Transactional email with local inbox preview                                                                           |
| **Observability**          | OpenTelemetry, Loki, Grafana, Alloy, Sentry               | Structured logs, traces, dashboards, error capture                                                                     |
| **Infrastructure**         | Caddy, Docker Compose, Terraform, AWS, Cloudflare         | Local substrate, reverse proxy, declarative cloud provisioning                                                         |
| **Quality / Governance**   | Vitest, Playwright, ESLint, OpenAPI drift, ADR validators | Unit, integration, architecture, accessibility, and evidence gates                                                     |

---

## Foundation capabilities

### Tenant administration control plane

The platform has a real tenant administration cockpit under `/admin`, not a placeholder settings page.

| Surface            | Capability                                                                         |
| ------------------ | ---------------------------------------------------------------------------------- |
| **Overview**       | Permission-filtered admin landing page                                             |
| **Members**        | Invite, role change, remove, username edit, status enable/disable, resend          |
| **Authentication** | Provider controls, readiness-aware Session editing, MFA/IdP + OIDC mapping         |
| **Features**       | Tenant feature toggles backed by shared configuration storage                      |
| **Config**         | Typed effective config grouped by category with overrides and reset                |
| **Email**          | Per-tenant sender (provider/identity), encrypted secret, readiness, test           |
| **Domains**        | Custom-domain DNS-TXT ownership + verification + routing readiness                 |
| **Storage**        | Object-storage readiness + tenant-prefix isolation probe                           |
| **Observability**  | Log-ingestion + Grafana/OTel/metrics/Sentry signals + label-guard                  |
| **Webhooks**       | Signed subscriptions, durable delivery worker, dead-letter redrive + metrics       |
| **Platform ops**   | Local service health, background workers, console links, proof ladder (local-only) |
| **Readiness**      | Capability map with honest per-capability readiness (never faked)                  |
| **Logs / Audit**   | Tenant-scoped admin logs and contextual audit panels                               |

Every admin surface follows the same React stack: TanStack Router, TanStack Query, Zod contracts, BFF REST clients, design-system components, MSW tests, accessibility assertions, and permission-aware rendering.

#### Local proof ladder

Each capability has a repeatable local runtime proof (`npm run proof:*`) — all honest-skip
(they `SKIP`, never fake, when a service is down) and **local-only**. The registry
(`PROOF_LADDER` in `@platform/contracts-admin`, surfaced at `/admin/platform` and
reconciled against `package.json` by `proof-registry.test.ts`):
`proof:auth-settings`, `proof:auth-idps`, `proof:auth-credential-lifecycle`,
`proof:auth-oidc-enterprise`, `proof:email-sender`, `proof:tenant-domains`,
`proof:tenant-domains-routing`, `proof:tenant-storage`, `proof:tenant-observability`,
`proof:webhooks`, `proof:webhook-worker`, `proof:webhook-redrive`, `proof:platform-services`,
`proof:backup-local`, `proof:domain-identity-matrix`, `proof:tenant-custom-domain-resolution`,
`proof:tenant-domain-canonical`, `proof:tenant-custom-domain-auth-origin`,
`proof:service-clickthrough-policy`.
Public DNS/TLS, real-IdP OIDC login mapping, and real Cloudflare/AWS-IAM/Brevo/Sentry
remain partial/deferred/blocked. See `docs/evidence/platform/platform-bedrock-foundation-review.md`.

### Tenant identity and membership v2

The identity model is explicit and tenant-safe:

```text
User                 global account, one row per email
TenantMembership     tenant-scoped identity, role, username, status, last login
ExternalIdentity     provider + subject links, email, linked/last-seen timestamps
```

Key decisions:

- Users are global; memberships are tenant-scoped.
- User email remains globally unique; multi-tenant access is modelled through memberships.
- Usernames are tenant-scoped and case-insensitively unique within an organisation.
- Membership statuses are explicit: `invited`, `active`, `disabled`.
- The last active tenant-admin cannot be disabled.
- Upstream IdP profile changes never overwrite the tenant username.
- External identities are visible from member detail without exposing secrets.

### Platform configuration registry

Configuration is now a governed platform capability, not a scatter of ad-hoc booleans.

```text
Definition default
  └─ tenant override in tenant_settings
        └─ effective config returned to the SPA
```

The registry defines key, category, value type, default value, allowed enum values, tenant override rules, read/write permissions, audit action, lifecycle, and validation.

The first slice includes feature flags plus representative branding, security, and integration settings. Feature flags remain backward-compatible with `/api/org/features` through shared `feature.<key>` storage, so existing code keeps working while the registry becomes the new source of configuration behaviour.

### Contextual audit trail

Audit is visible where administrators need it.

| Context     | Audit surface                                            |
| ----------- | -------------------------------------------------------- |
| **Members** | Per-member recent activity in the expanded detail panel  |
| **Config**  | Recent configuration changes on `/admin/config`          |
| **Auth**    | Provider configuration changes on the Auth Providers tab |

The tenant-scoped audit query supports logical resource, resource id, action, actor, timestamp filters, and metadata redaction. The frontend cannot pass tenant authority; the BFF derives tenant context from session/FQDN.

### Per-tenant auth settings readiness

The platform now has the credential substrate required for safe tenant-admin auth settings writes.

- New tenants get a per-tenant Keycloak realm-admin service-account credential during provisioning.
- Legacy tenants can be operator-seeded through a system-admin attach-and-validate endpoint.
- Credential readiness is classified as `configured`, `missing_credential`, `invalid_credential`, `forbidden_realm_operation`, or `realm_unreachable`.
- Realm write errors map to precise 400/403/502/503 responses instead of opaque 500s.
- Session policy is the first writable Auth tab.
- MFA and IdP management remain intentionally read-only until their own follow-up slices.
- Secrets never reach the SPA, logs, or audit metadata; client secrets are encrypted at rest.

---

## Architecture

### Hexagonal, import-enforced, dependency-injected

```text
Browser → React SPA → BFF Pipeline → Use Cases → Repository Ports → Adapters → External Systems
```

Import rules are **machine-enforced** by `validate-source-imports`. Violations are build-time failures — not PR comments.

| Package group               | Can import                                    | Cannot import                                        |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `domain-*`                  | `observability`, `platform-errors`            | Pino, OTel SDK, Keycloak SDK, Postgres, Redis, React |
| `contracts-*`               | Zod and pure DTO dependencies                 | Adapters, BFF internals, React runtime state         |
| `feature-*`                 | Domain, contracts, runtime context            | Adapters, infrastructure, BFF internals              |
| `adapters-*`                | Platform runtimes, domain ports               | Other adapters, React, BFF routes                    |
| `ui-design-system`          | React Aria, Tailwind                          | Backend packages, adapters, domain logic             |
| `apps/react-enterprise-app` | Feature hooks, contracts, i18n, design system | `pino`, `pg`, `ioredis`, Keycloak SDK                |

> [!IMPORTANT]
> The React app is browser-only. It cannot import database clients, migrations, Redis sessions, Keycloak SDKs, token exchange logic, or server adapters. The BFF owns all of that. This boundary is enforced at the compiler/tooling level — not by convention.

![Application dependency map](docs/images/application-dependency-map.svg)

### Governed package architecture

Every package carries machine-validated metadata: lifecycle class, bounded context, package name, description, runtime role, public export policy, and dependency constraints. Lifecycle transitions require evidence bundles.

Representative packages:

| Package                 | Role                                                |
| ----------------------- | --------------------------------------------------- |
| `domain-core`           | Pure domain primitives                              |
| `domain-identity`       | User, Organisation, Membership, ExternalIdentity    |
| `contracts-auth`        | Auth session and actor contracts                    |
| `contracts-admin`       | Admin/control-plane DTOs and validation schemas     |
| `contracts-graphql`     | GraphQL type definitions shared across the boundary |
| `adapters-keycloak`     | Keycloak realm admin, readiness, provisioning, UMA  |
| `adapters-postgres`     | SQL repositories, RLS, tenant schema helpers        |
| `adapters-redis`        | Session store and PKCE state                        |
| `adapters-loki`         | Log query/runtime adapter                           |
| `platform-logging`      | Pino-backed server and browser structured logging   |
| `platform-errors`       | Typed error hierarchy                               |
| `session-runtime`       | Session store abstraction                           |
| `audit-events`          | Typed audit event definitions and port              |
| `authorisation-runtime` | Permission model, UMA types, resource policies      |
| `i18n-runtime`          | `I18nProvider`, `useTranslation`, locale loading    |
| `ui-design-system`      | React Aria + Tailwind component library             |
| `api-runtime`           | BFF request/response pipeline helpers               |
| `graphql-api-runtime`   | Schema execution, resolver types, context           |
| `config-runtime`        | Environment configuration helpers                   |
| `test-support`          | Shared test fixtures and substrate helpers          |

---

## React capabilities

### TanStack Router — fully typed routing

Route parameters, search parameters, and loader data are typed end-to-end. No string casting, no runtime surprises.

```typescript
export const Route = createRoute({
  getParentRoute: () => AdminLayoutRoute,
  path: "members",
  component: AdminMembersRoute,
});
```

The authenticated layout owns the single `<main id="main-content">`. Child routes use `RequirePermission`, and admin navigation only renders entries the actor can reach.

### TanStack Query — server state done right

Server data lives in the query cache. Stale-time, background refetch, cache invalidation, and mutation refreshes happen at the hook layer.

```typescript
const { data, isLoading, isError } = useMembers();
const updateRole = useUpdateMemberRole();
```

Admin mutations invalidate only the relevant query families: members, config, audit, auth readiness, or provider config.

### React Hook Form + Zod — contract-driven forms

Forms validate against the **same Zod schema** used by the API. Session settings, config values, invitations, usernames, and membership status changes are all contract-driven.

```typescript
const form = useForm<UpdateConfigValueRequest>({
  resolver: zodResolver(UpdateConfigValueRequestSchema),
});
```

### React Aria Components — accessible by construction

Interactive components are built on `react-aria-components`. Keyboard navigation, ARIA state management, selected/focused state, and focus containment are handled at the primitive layer.

### i18n — no hardcoded strings

All user-visible strings go through `@platform/i18n-runtime`. The architecture validator enforces that every `t()` key exists in `en-GB.json` — missing translations are a build failure.

### WCAG 2.2 Level AA

> [!NOTE]
> The shell and admin surfaces are accessibility-tested before product features are built. Accessibility is foundational, not retrofitted.

- Skip navigation link as the first focusable element on every route
- `lang="en-GB" dir="ltr"` on the HTML element
- Form fields with linked labels, errors, and `aria-invalid`
- Always-mounted live regions for async feedback
- Focus-visible rings on all interactive elements
- Semantic `<main id="main-content">` landmark on every authenticated route
- Axe coverage across admin pages and shared components

---

## Administrative UI development is open

The platform has moved beyond a pre-UI shell. New product features now have a hardened administrative foundation to build on.

What is in place:

- **Generated GraphQL contracts.** Operations are authored as `.graphql` documents in `@platform/contracts-graphql`; `npm run codegen` emits browser-safe `TypedDocumentNode` artifacts.
- **Authenticated layout.** The `_authenticated` route owns the auth gate and AppShell. Per-route permissions use `RequirePermission`.
- **Admin layout.** `/admin` provides a responsive sidebar/mobile nav pattern, section headers, guarded routes, and consistent error semantics.
- **BFF REST admin clients.** Admin control-plane calls go through typed BFF clients — never direct adapter imports.
- **MSW substrate.** Personas, handlers, GraphQL factories, session fixtures, and admin mocks support UI tests without hand-rolled fetch mocks.
- **Theme tokens.** Semantic CSS variables drive colour; `/api/theme` can override tenant branding at bootstrap.
- **Contextual audit panels.** Admin pages can show read-only recent activity in the relevant context.

Scaffold a feature:

```bash
npm run generate:feature -- --name=<name> --type=form-edit|read-only-detail|table-search|admin-settings
```

Gates for UI work:

```bash
npm run codegen:check
npm run tsc:check
npm run test:frontend:run
npm run test:platform-api
npm run test:architecture
npm run validate:slices
make check
```

---

## Authentication

### Zero tokens in the browser

The login flow is a proper **Authorization Code + PKCE** exchange through the BFF. Raw tokens never reach the browser.

```text
Browser   →  GET /auth/login       BFF generates PKCE challenge, stores state in Redis
BFF       →  302 to Keycloak       Keycloak renders tenant realm login
Keycloak  →  302 /auth/callback    BFF exchanges code for tokens
BFF       →  createSession()       tokens encrypted AES-256-GCM, stored in Redis
BFF       →  Set-Cookie: session   HttpOnly · SameSite=Lax · Secure
Browser   →  GET /api/session      receives safe actor object — no tokens exposed
```

```typescript
const { actor, isAuthenticated, hasPermission } = useSession();
// actor: { userId, displayName, email, organisationId, roles, permissions }
```

### Tenant-aware provider configuration

Login providers are tenant-aware:

- Platform login is always available.
- Third-party providers are gated by environment mode and tenant config.
- `/api/auth/providers` resolves tenant from FQDN.
- `/auth/login?provider=` rejects unknown, malformed, or not-enabled providers through a safe 400 path.
- Provider settings are stored per tenant in `tenant_settings.auth.providers`.
- Provider changes are audit-first and visible in contextual audit.

### Auth settings readiness

Tenant-admin auth settings writes require a per-tenant Keycloak realm-admin credential.

```text
GET /api/auth/settings/readiness
  configured
  missing_credential
  invalid_credential
  forbidden_realm_operation
  realm_unreachable
```

The Session policy tab is readiness-aware and writable when the tenant is configured and the actor has `tenant.auth.settings.write`. MFA and IdP management are intentionally read-only until their own hardening slices.

### Session security

| Protection       | Implementation                                                                     |
| ---------------- | ---------------------------------------------------------------------------------- |
| Token encryption | AES-256-GCM, random IV, GCM auth tag; startup throws in production if key absent   |
| Cookie flags     | `HttpOnly`, `SameSite=Lax`, `Secure`                                               |
| Logout           | Dual-cookie clear plus RP-Initiated Logout to Keycloak end-session                 |
| Redirect safety  | `safeRelativeRedirect()` rejects absolute URLs in `returnTo`                       |
| PKCE             | Random verifier, S256 challenge, one-use Redis state, nonce bound to user-agent    |
| Forward-auth     | `CADDY_INTERNAL_SECRET` required in staging/production; startup throws if absent   |
| Realm admin      | Per-tenant credential encrypted at rest; secret never returned, logged, or audited |

---

## Multi-tenancy

Tenant isolation is structural, not a flag. Every layer isolates independently.

| Layer          | Isolation mechanism                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | Schema-per-tenant + Row-Level Security. Runtime pool connects as `platform_app` (`NOSUPERUSER`, `NOBYPASSRLS`). RLS enforced at the database engine — no application-layer bypass possible. |
| **Keycloak**   | Per-tenant realm. Each tenant owns users, IdP federation, MFA policy, session lifetime, BFF clients, and realm-admin credential.                                                            |
| **Routing**    | `aldous.info` → system admin. `{slug}.aldous.info` → tenant app. BFF resolves tenant from FQDN on every request.                                                                            |
| **Redis**      | Per-tenant session namespace prefix.                                                                                                                                                        |
| **S3 / MinIO** | Per-tenant object prefix with bucket policy enforcement.                                                                                                                                    |

### Tenant provisioning — atomic and idempotent

`POST /api/admin/tenants` orchestrates all layers with rollback on failure:

```text
1. PostgreSQL  → create schema, run tenant migrations, seed organisation records
2. Keycloak    → create realm, BFF client, PKCE config, mappers, auth server
3. Auth admin  → create/store per-tenant realm-admin service credential
4. UMA         → register resources and scopes
5. Redis       → create session namespace
6. S3          → create object prefix
   ↳ Any step fails → rollback completed steps automatically
```

Legacy tenants can receive or rotate the auth-settings credential through the system-admin attach-and-validate endpoint. The credential is validated against the realm before storage.

### FQDN routing via Caddy

```text
aldous.info            → system admin (system_admin role required)
{slug}.aldous.info     → tenant React app + BFF
aldous.info/kc         → Keycloak (all realms)
aldous.info/grafana    → Grafana (observability-gated)
aldous.info/sentry     → Sentry (profile-gated)
aldous.info/mailpit    → Mailpit (admin-gated)
aldous.info/minio      → MinIO console (admin-gated)
aldous.info/sonar      → SonarQube (admin-gated)
aldous.info/wiremock   → WireMock admin (dev-only, not exposed in production)
```

All admin tool routes go through Caddy forward-auth — the BFF validates session and role before proxying.

---

## Authorisation

### UMA with static backstop

Every protected API route declares resource, scope, and static permission. The BFF evaluates Keycloak UMA at runtime and falls back to static permission checks only when the route is explicitly safe to do so.

```typescript
{
  path: "/api/org/config",
  method: "PATCH",
  resource: "admin:config",
  umaScope: "write",
  requiredPermission: "tenant.config.write",
}
```

### Permissioned control surfaces

| Permission                   | Surface / Capability                                   |
| ---------------------------- | ------------------------------------------------------ |
| `tenant.admin.access`        | Admin shell entry                                      |
| `tenant.members.read`        | Members list, member detail, external identities       |
| `tenant.members.invite`      | Invite and resend invitation                           |
| `tenant.members.update_role` | Role, username, and status updates                     |
| `tenant.auth.settings.read`  | Auth settings, provider config, readiness              |
| `tenant.auth.settings.write` | Provider config and writable auth settings             |
| `tenant.config.read`         | Platform configuration registry                        |
| `tenant.config.write`        | Config overrides and reset                             |
| `tenant.audit.read`          | Contextual audit panels                                |
| `platform.tenants.create`    | System-admin tenant provisioning and credential attach |

### Support mode

System administrators can enter a tenant context with a full audit trail:

- Reason required
- Audit event persisted before session creation
- Separate `supportSessionId`
- `canAccessTenantFqdn()` enforces tenant boundary throughout the request lifecycle

---

## Audit trail

Every state-changing operation emits a persistent audit event **before** the mutation executes. Audit failure aborts the operation — the external system is never modified without a record.

```typescript
await deps.audit.emit(createAuditEvent({ actorId, tenantId, action, resource, metadata }));
// If this throws, execution stops here.

await deps.realmAdmin.setSessionPolicy(policy);
// External mutation is only reached if audit succeeded.
```

> [!IMPORTANT]
> Audit-before-mutation ordering is tested explicitly. This guarantee is not maintained by convention — it is verified on every run.

Audited operations now include: member invitation, role change, username change, status change, invite resend, feature toggles, config value changes and clears, provider config changes, session settings, auth credential attach, support-mode entry, resource policies, vanity domains, and tenant provisioning events.

Contextual audit panels expose recent activity without leaking secrets:

- Members: `resource=member`, `resourceId=userId`
- Config: `resource=config`
- Auth Providers: `resource=auth_settings`, `resourceId=providers`

Audit DTOs redact metadata keys matching secret/password/token/credential and never expose `ipAddress` or `userAgent`.

---

## Observability

```text
platform-api (Pino JSON stdout)
  └─→ Grafana Alloy  (container discovery, JSON parse, label extraction)
        └─→ Loki  (30-day retention, TSDB v13)
              └─→ Grafana  (pre-provisioned dashboard)

OpenTelemetry Collector  (OTLP gRPC on :4317, HTTP on :4318)

Sentry  (adapter-wired, opt-in via SENTRY_ENABLED=true)
```

Every request log line carries request, trace, actor, tenant, route, duration, and status metadata. High-cardinality fields stay out of Loki labels and remain queryable as structured metadata.

Grafana dashboard panels are provisioned at startup: error/warning rates, slow requests, top failing routes, and per-tenant breakdowns.

Per-environment OTel collector ports avoid cross-environment telemetry bleed: dev `:4317`, test `:4322`, staging `:4327`, prod `:4332`.

---

## Testing

### Coverage by layer

| Suite            | Latest documented result | What it covers                                                                                                      |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Architecture** | 768 passing              | Import boundaries, package metadata, lifecycle evidence, i18n coverage, OpenAPI drift, action-register governance   |
| **Platform API** | 388 passing              | Use cases, domain logic, auth pipeline, PKCE, session cookies, RLS, audit ordering, config registry, auth readiness |
| **Frontend**     | 115 passing              | Vitest + RTL, MSW-backed admin surfaces, accessibility, error semantics, audit refresh, auth settings forms         |
| **E2E dev**      | `make e2e-dev`           | Playwright — full browser, real TanStack Router, fixture session                                                    |
| **E2E prod**     | `make e2e-prod`          | Playwright — real Keycloak, live `aldous.info`, external routes                                                     |
| **Compose**      | `npm run test:compose`   | Docker Compose profile validation and port conflict detection                                                       |

> Latest documented gates: orchestrator `all --strict`, OpenAPI drift, contract-drift, ADR-reference validation, platform-api 388/388, frontend 115/115, architecture 768/768.

### Critical ordering tests

Audit-before-mutation ordering is verified explicitly with mock call-order assertions across Keycloak, tenant settings, member mutations, config changes, support mode, and credential attach flows.

### Runtime evidence

Evidence lives with the repo:

| Evidence file                                                            | What it proves                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `docs/evidence/admin/tenant-administration-control-plane.md`             | Admin shell, Members/Auth/Features, typed contracts           |
| `docs/evidence/admin/live-tenant-admin-walkthrough.md`                   | Runtime provider/login probes and manual admin walkthrough    |
| `docs/evidence/identity/tenant-identity-membership-v2.md`                | User vs membership model, username/status/last-login          |
| `docs/evidence/configuration/platform-configuration-registry.md`         | Typed config registry, feature compatibility, `/admin/config` |
| `docs/evidence/audit/admin-contextual-audit-trail.md`                    | Tenant-scoped contextual audit panels and metadata redaction  |
| `docs/evidence/auth/per-tenant-auth-settings-credential-provisioning.md` | Auth settings readiness, credential provisioning, Session UI  |

---

## Four isolated environments

`make all` promotes code through four fully isolated environments in sequence.

```text
preflight
  └─→ dev   (port 3001, volatile data, all test groups)
        └─→ test     (port 3002, volatile data, all test groups)
              └─→ staging  (port 3003, seeded data, all test groups)
                    └─→ prod     (port 3004, seeded data, smoke only)
                          └─→ evidence written to docs/evidence/stages/
```

Each stage has its own Compose project, credentials, data policy, and OTel port allocation. Failure at any stage stops promotion. Every passing run commits signed evidence JSON — every deploy has a verifiable record.

![Readiness tiers](docs/images/readiness-tiers.svg)

---

## Security posture

| Surface                  | Control                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Token storage**        | AES-256-GCM in Redis; startup throws in production if key absent                                  |
| **Cookies**              | `HttpOnly`, `SameSite=Lax`, `Secure`; dual-clear on logout                                        |
| **Open redirects**       | `safeRelativeRedirect()` rejects absolute URLs                                                    |
| **CSP**                  | `default-src 'self'` + hardened base/form/object/frame policies                                   |
| **SQL injection**        | Parameterised queries; schema identifiers via escaped adapter helpers                             |
| **RLS**                  | Runtime role is `NOSUPERUSER`, `NOBYPASSRLS`; RLS bypass uses controlled role membership only     |
| **Keycloak credentials** | Per-tenant realm-admin credential is write-only, encrypted at rest, never returned/logged/audited |
| **Tenant authority**     | Tenant context comes from FQDN/session, not frontend body values                                  |
| **Forward-auth**         | `CADDY_INTERNAL_SECRET` required in staging/production; startup throws if absent                  |
| **Audit**                | Persistent Postgres record before every mutation; audit failure aborts execution                  |
| **Secret scanning**      | gitleaks pre-commit hook, OSV scanner, `npm audit`, CodeQL, SonarQube                             |

---

## Governance

### 41 ADRs, all accepted

Every structural decision is an ADR. Every ADR is a constraint enforced by the architecture orchestrator.

<details>
<summary>ADR index</summary>

| ADR  | Decision                                                                      |
| ---- | ----------------------------------------------------------------------------- |
| 0001 | Use modular hexagonal architecture                                            |
| 0002 | Model the platform around bounded contexts                                    |
| 0003 | Use a modular monorepo with promotion-ready package boundaries                |
| 0004 | Define package lifecycle classes                                              |
| 0005 | Define package metadata vocabulary and format                                 |
| 0006 | Define package lifecycle transition rules                                     |
| 0007 | Define architecture artifact and repository directory layout                  |
| 0008 | Define generated package README structure                                     |
| 0009 | Define package inventory and report structure                                 |
| 0010 | Define lifecycle transition evidence bundle format                            |
| 0011 | Define architecture tooling execution model                                   |
| 0012 | Define architecture tooling test, validation, TUI, and self-evidence strategy |
| 0013 | Define client-facing API boundary                                             |
| 0014 | Define transactional data ownership                                           |
| 0015 | Define analytical data ownership                                              |
| 0016 | Define enterprise quality gate and security baseline                          |
| 0017 | Define local integration service substrate                                    |
| 0019 | Define React component platform and frontend integration stack                |
| 0020 | Define observability, diagnostics, and runtime introspection primitives       |
| 0021 | Define identity, tenancy, roles, and permissions model                        |
| 0022 | Define authentication, session, and SSO integration boundary                  |
| 0023 | Define declarative infrastructure provisioning model                          |
| 0024 | Define slice readiness and dependency gate model                              |
| 0025 | Define Playwright end-to-end testing strategy                                 |
| 0026 | Define internationalisation and translation resource model                    |
| 0027 | Define Tilt local development feedback loop                                   |
| 0028 | Define GraphQL schema boundary governance                                     |
| 0029 | Define multi-tenant isolation boundaries                                      |
| 0030 | Define dynamic authorisation and tenant admin self-service                    |
| 0031 | Define infrastructure provisioning privilege model                            |
| 0032 | E2E testing strategy                                                          |
| 0033 | Define environment-specific domain and hostname configuration                 |
| 0034 | Define per-environment test composition                                       |
| 0035 | Enterprise log indexing and search                                            |
| 0036 | Tenant administration control plane                                           |
| 0037 | Per-tenant authentication provider configuration                              |
| 0038 | Tenant identity and membership v2                                             |
| 0039 | Platform configuration registry                                               |
| 0040 | Administrative audit trail and control-plane verification                     |
| 0041 | Per-tenant auth settings credential provisioning                              |

</details>

### Architecture orchestrator — executable governance

```bash
node tools/architecture/orchestrator/src/index.mjs all --strict

✓ validate-package-metadata       package metadata and lifecycle classes
✓ validate-source-imports          import boundary enforcement
✓ generate-package-readmes         generated READMEs match package metadata
✓ generate-package-inventory       package graph snapshot current
✓ validate-lifecycle-evidence      promotions have evidence bundles
✓ validate-slice-readiness         slice dependencies satisfied
✓ validate-i18n                    all t() keys exist in en-GB.json
✓ validate-pipeline-composition    BFF route port composition valid
✓ validate-compose-ports           no port conflicts across Compose profiles
✓ validate-action-register         ACTION-REGISTER rows reference real ADRs
✓ validate-openapi-drift           OpenAPI stays aligned to implemented routes
```

---

## Local development

### Start the platform

```bash
npm ci
make compose-up-default          # Postgres, Redis, ClickHouse, MinIO, Mailpit, OTel
make compose-up-identity         # + Keycloak (SSO, per-tenant realms)
make compose-up-web              # + Caddy (full FQDN routing on aldous.info)
tilt up                          # hot-reload dev loop — http://localhost:10350
```

### Local URLs

| Service      | Direct                           | Via Caddy                    |
| ------------ | -------------------------------- | ---------------------------- |
| React app    | `http://localhost:5173`          | `http://aldous.info`         |
| Platform API | `http://localhost:3001`          | `http://aldous.info/api`     |
| Keycloak     | `http://localhost:8080/kc/admin` | `http://aldous.info/kc`      |
| Mailpit      | `http://localhost:8025`          | `http://aldous.info/mailpit` |
| MinIO        | `http://localhost:9001`          | `http://aldous.info/minio`   |
| Grafana      | `http://localhost:3100`          | `http://aldous.info/grafana` |
| SonarQube    | `http://localhost:9003`          | `http://aldous.info/sonar`   |
| Sentry       | —                                | `http://aldous.info/sentry`  |
| Tilt UI      | `http://localhost:10350`         | —                            |

### Common commands

```bash
make help                        # all available targets with descriptions
make check                       # format + lint + typecheck + architecture gates
make all                         # full 4-stage environment promotion with evidence
make fix                         # auto-fix formatting issues
make db-migrate                  # run pending migrations
make db-shell                    # psql shell (dev environment)
make seed-demo                   # populate demo organisations and users
make redis-flush-local           # clear Redis (dev)
make compose-ps                  # service status across all environments
make compose-logs                # tail service logs

npm run test:platform-api        # API + domain + BFF tests
npm run test:frontend:run        # frontend Vitest suite
npm run test:architecture        # architecture/governance test suite
npm run openapi:drift            # OpenAPI implementation drift check
make e2e-dev                     # Playwright E2E (dev, fixture session)
make e2e-prod                    # Playwright E2E (production, real Keycloak)
```

---

## Repository structure

```text
apps/
  platform-api/             Node.js BFF — pipeline, routes, use cases, session, provisioning
  react-enterprise-app/     React 19 SPA — router, admin surfaces, features, hooks, MSW

packages/                   Governed packages: domain, contracts, adapters, runtimes, UI, tooling

tools/architecture/         Governance tooling — orchestrator, validators, generators
docs/adr/                   Architecture Decision Records + ACTION-REGISTER
docs/CODEMAPS/              Machine-readable architecture maps for AI and review context
docs/evidence/              Verification evidence by architecture slice and stage
infra/                      Terraform modules (Keycloak, AWS, Cloudflare)
docker/                     Caddy, OTel, Loki, Grafana, Alloy, WireMock configurations
compose.yaml                Local substrate across Docker Compose profiles
Makefile                    Developer workflow (make help for all targets)
env/stage-policy.yaml       Per-stage executor, data policy, and test group configuration
```

---

## Why this foundation is optimal

<!-- markdownlint-disable MD028 -->

> [!TIP]
> **Security without ceremony.** Insecure patterns are structurally impossible. The React app cannot import server packages. Tokens are never in the browser. Realm-admin credentials are write-only and encrypted. Every mutation is audited before it runs.

> [!TIP]
> **Multi-tenancy without magic.** Isolation is at every layer — database schema, RLS, Keycloak realm, Redis namespace, S3 prefix, FQDN routing, tenant-scoped config, and tenant-scoped memberships. There is no flag that enables multi-tenant mode. The system is multi-tenant by construction.

> [!TIP]
> **An admin cockpit before product sprawl.** Tenant admins can manage members, auth providers, session policy, feature/config values, and inspect audit context before generic product modules exist. Product features will land inside a governed control plane rather than inventing one.

> [!TIP]
> **Governance that survives team growth.** 41 ADRs are executable specifications, not static documentation. The orchestrator validates imports, i18n keys, OpenAPI drift, package metadata, action-register references, and slice readiness on every run.

> [!TIP]
> **Testing with real boundaries.** API and domain tests exercise the BFF, Postgres, Redis, Keycloak adapter contracts, audit ordering, and admin use cases. Frontend tests use MSW at the service boundary, not hand-rolled component mocks.

> [!TIP]
> **React done correctly.** TanStack Router eliminates untyped params. TanStack Query eliminates duplicated fetch logic. React Hook Form + Zod aligns form validation with API contracts. React Aria prevents accessibility debt from becoming a retrofit project.

<!-- markdownlint-enable MD028 -->

The shell exists to be built on, not torn apart. Routes are typed. The session model is live. The permission system is enforced. Tenant identity is explicit. Config is governed. Audit is inspectable. Auth settings have readiness-aware write paths. The first product feature can extend what exists — not work around it.

---

## License

MIT
