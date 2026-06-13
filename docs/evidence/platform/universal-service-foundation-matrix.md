# Universal Service Foundation Matrix

- **Action:** ADR-ACT-0237
- **Source ADRs:** ADR-0053/0054/0055/0056/0058 (Accepted, ADR-ACT-0253/0254); ADR-0057, ADR-0059–0066 (Proposed)
- **Date:** 2026-06-13
- **Status of this document:** discovery + architecture decision artifact. It is **not** a claim that the universal foundation exists.

## Purpose and honesty rules

This matrix defines what is required to evolve the platform from a **tenant control-plane foundation** into a **multipurpose software-provider substrate**. It is source-driven: every status is traced to code, contract, proof, or evidence, not to comments or container presence.

Two rules are enforced mechanically by `npm run usf:validate`
(`tools/architecture/validate-universal-foundation`):

1. **A running container is not a delivered capability.** MinIO running is not a storage product; ClickHouse running is not an analytics product; Grafana running is not alerting/incident management; Redis running is not durable workflow orchestration; LocalStack running is not a cloud substrate.
2. **No paid SaaS account may be required to run, test, or prove a capability locally.** Paid providers may appear only as later production adapters, never as a local-proof dependency. The one unavoidable exception is payment capture (see `subscriptions-invoices-payments`).

The authoritative, machine-readable record is
[`universal-service-foundation-registry.json`](./universal-service-foundation-registry.json)
(24 fields per capability). The tables in this document are **generated from that file** — do not edit them by hand; run `npm run usf:render`.

Status vocabulary (the only permitted values): `delivered`, `locally proven`, `partial`, `api-only`, `ui-only`, `compose-only`, `mock-only`, `deferred`, `missing`, `blocked`, `not applicable`. The word "complete" is deliberately not in the vocabulary.

## Companion documents

- [`docs/architecture/universal-service-foundation.md`](../../architecture/universal-service-foundation.md) — scope and principles (ADR-0053).
- [`docs/architecture/build-versus-compose-decision-framework.md`](../../architecture/build-versus-compose-decision-framework.md) — the build/compose/adapter/defer/reject rubric (ADR-0054).
- [`docs/architecture/environment-service-classification.md`](../../architecture/environment-service-classification.md) — per-environment vs shared vs mock vs forbidden (ADR-0056).

Delivery hardening (ADR-ACT-0252), source-driven from this registry's `delivery` block:

- [`universal-service-foundation-delivery-dependencies.md`](./universal-service-foundation-delivery-dependencies.md) — the dependency graph: what each capability depends on, blocks, can run in parallel with, and must precede; the required dependency truths the validator enforces.
- [`universal-service-foundation-implementation-roadmap.md`](./universal-service-foundation-implementation-roadmap.md) — Phases 0–10 with objectives, unlocks, files/packages/ports/contracts/UI, proof scripts, acceptance criteria, size, risk, and stop conditions; includes the per-ADR decision-quality assessment.
- [`universal-service-foundation-provider-shortlist.md`](./universal-service-foundation-provider-shortlist.md) — local-first candidate evaluation per composed capability, with explicit GPL/AGPL/SSPL/BUSL license flags.

## Phase 1 — source-driven inventory (what exists today)

Traced to `compose.yaml`, `docker/caddy/*`, `apps/platform-api/src/usecases/*`, `apps/platform-api/src/server/routes.ts`, `packages/contracts-admin/src/*`, `apps/react-enterprise-app/src/*`, `docs/adr/ACTION-REGISTER.md`, and `docs/evidence/platform/*`.

### Composed services (Compose profiles)

- **Default (per-environment, always-on):** `postgres`, `redis`, `clickhouse`, `minio`, `mailpit`, `otel-collector`, `pgadmin`.
- **identity (per-environment):** `keycloak` + `keycloak-postgres`; **identity-mocks:** `mock-oidc` (per-env fixture).
- **observability (per-environment):** `loki`, `grafana`, `alloy`.
- **web (per-environment):** `platform-api`, `react-app`; **external-web:** `external-caddy` (host routing).
- **external-sonar (shared instance, `react-sonar` project):** `sonarqube` + `sonar-postgres`.
- **external-sentry (shared instance, `react-sentry` project):** ~20 Sentry services incl. its own `sentry-kafka`, `sentry-clickhouse` (errors-only mode, ADR-ACT-0089).
- **Mocks (forbidden in production):** `wiremock` (external-mocks), `localstack` (cloud-mocks), `mock-oidc` (identity-mocks).

### Capability surfaces that already exist

- **BFF capability registry** (`capability-registry.ts`): 44 capabilities across identity/authentication/configuration/operations/integrations with per-capability `implementationStatus` (`implemented`/`partial`/`deferred`) and a readiness model.
- **Platform service catalog** (`platform-services.ts`): 17 services with an honest 8-value status vocabulary + 1 background worker (`webhook-delivery`).
- **Service clickthrough policy** (`service-clickthrough.ts`): 11 services classified `tenant_scoped_safe` / `global_only` / `not_exposed` with explicit isolation invariants.
- **Admin UI** (`react-enterprise-app`): 13 delivered admin routes (readiness, members, auth, features, config, email, domains, storage, observability, webhooks, platform, logs) + org profile.
- **Proof ladder** (`contracts-admin/proof-registry.ts`): 20 executable `proof:*` scripts.

### Largest gaps found (no code, no route, no adapter)

Billing/metering/entitlements; product search; workflow engine; multi-channel notifications; alerting/incident/on-call/status page; data governance (catalog, lineage, classification, PII, DSR); PITR/retention/legal-hold/residency; API keys/developer portal/SDK/rate-limits; tenant suspend/delete/export; support ticketing. `search-runtime`, `queue-runtime`, `notification-runtime`, `worker-runtime`, and `profile-configuration` exist only as **port-only scaffolds** (interfaces + in-memory stubs) — they are not wired to adapters, routes, or UI, and are scored accordingly.

## Phase 2 + 3 — the matrix (by capability domain)

Each domain has two generated tables: a **decision view** (status, build/compose decision, local free candidate, environment model, priority/size/risk) and a **governance view** (isolation, permission, audit, readiness, contract, UI, proof, blockers, ADR linkage). Full per-field data is in the JSON registry.

<!-- USF-TABLE:START — generated by tools/architecture/validate-universal-foundation; do not edit by hand -->

<!-- Generated from docs/evidence/platform/universal-service-foundation-registry.json on 2026-06-13. 55 capability rows. -->

### Identity and access

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant-identity` | locally proven | A tenant is a first-class isolated entity with a stable record and host identity. | postgres (per-env), keycloak realm (per-env) | build | Postgres + Keycloak (already composed) | per-environment | per-env | P0 | M | Low |
| `user-identity` | delivered | Users belong to tenants with roles and membership status. | keycloak (per-env) + postgres | build | Keycloak (already composed) | per-environment | per-env | P0 | M | Low |
| `end-user-profile-self-service` | missing | End users manage their own profile, preferences, notification settings, sessions, and devices. | keycloak account console (not surfaced); profile-configuration port scaffold only | build | Keycloak Account console + Postgres-backed profile-configuration adapter | per-environment | per-env | P1 | L | Medium |
| `api-keys-pat` | locally proven | Programmatic credentials for users and service accounts. | postgres (api_keys, RLS); scrypt hashing in-process | build | Postgres + Node scrypt (api-key-crypto); built-in | per-environment | per-env | P1 | L | High |
| `groups` | api-only | Group membership for bulk role assignment. | keycloak realm groups | build | Keycloak (composed) | per-environment | per-env | P2 | M | Low |
| `sub-organisations` | api-only | Nested organisational units within a tenant. | postgres | build | Postgres (composed) | per-environment | per-env | P2 | M | Low |
| `rbac` | delivered | Role-based access for tenant members. | keycloak | build | Keycloak roles (composed) | per-environment | per-env | P0 | S | Low |
| `abac-pdp` | partial | Attribute-based, runtime-configurable authorization decisions. | keycloak Authorization Services (UMA 2.0 PEP) — authorisation-runtime is real | build | Keycloak UMA (current); OPA/Cedar adapter as an optional external PDP | per-environment | per-env | P0 | L | High |
| `delegated-admin-roles` | deferred | Tenant admins grant scoped admin rights to others. | keycloak | build | Keycloak fine-grained admin + custom scope mapping | per-environment | per-env | P2 | L | Medium |
| `entitlements` | locally proven | Resolve what a tenant/plan is entitled to use; gate features by entitlement, not just flags. | feature flags exist but are not plan-linked entitlements | build | custom entitlement table + OpenMeter/Lago plan link | per-environment | per-env | P1 | L | High |
| `support-mode-breakglass` | partial | Time-boxed, audited operator access into a tenant. | support-session usecase (audited) | build | built-in support-session + approval workflow (to build) | per-environment | per-env | P1 | M | High |
| `privileged-access-audit` | delivered | Durable, tenant-scoped audit of admin and privileged operations. | postgres audit_events | build | Postgres (composed) | per-environment | per-env | P0 | S | Low |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant-identity` | schema-per-tenant + RLS (ADR-0029) | row-level via tenant schema; FQDN host authority | platform.tenants.read/create | tenant provisioning audited | tenant-context readiness kind (always ready once resolved) | POST /api/admin/tenants; GET /api/host-identity | system-admin provisioning (partial UI) | n/a | proof:domain-identity-matrix; proof:tenant-custom-domain-resolution | none for core record | ADR-0029, ADR-0021 | ADR-ACT-0237 | Foundation already delivered; listed for completeness. |
| `user-identity` | realm-scoped users; membership rows tenant-scoped | RLS on membership | tenant.members.read/invite/update_role/delete | member mutations audited | admin-count readiness kind | /api/org/members* | /admin/members (delivered) | partial (org profile only) | members unit + substrate tests | none | ADR-0036, ADR-0038 | ADR-ACT-0237 | Delivered control-plane capability. |
| `end-user-profile-self-service` | user belongs to one realm; preferences tenant+user scoped | RLS on preferences table (to build) | self (own user) scope | profile/preference change audit (to build) | n/a (always-on once built) | missing (no /api/me/profile route) | n/a | missing (only org profile exists) | not-yet-proven | no persistence adapter; no route; no UI | ADR-0058 | ADR-ACT-0249 | packages/profile-configuration is an in-memory port scaffold; not wired. |
| `api-keys-pat` | key tenant-scoped (RLS); UNIQUE prefix lookup | only a salted+peppered scrypt hash stored; plaintext shown once; RLS | tenant.api_keys.read/write; platform.api_keys.read | api_key.created + api_key.revoked (audit-before-change) | n/a (always-on once built) | /api/org/api-keys; /api/admin/tenants/:tenantId/api-keys | /admin/developer | tenant-admin (create/revoke + one-time secret reveal) | proof:api-keys; proof:api-key-routes | API_KEY_PEPPER must be set in production (dev default is local-only) | ADR-0065 | ADR-ACT-0257 | Phase 3 delivered + live-proven: server-generated, hashed, entitlement-gated (api_access), revocable, tenant-scoped. Secret shown once; never returned by list/read. |
| `groups` | realm-scoped groups | realm boundary | tenant.groups.read/create/update/delete | group CRUD (best-effort) | invariant-ready | /api/org/groups* (present) | missing (no groups page) | n/a | groups unit tests | no admin UI | ADR-0021, ADR-0058 | ADR-ACT-0234 | capability-registry marks tenant_groups partial; routes exist, UI does not. |
| `sub-organisations` | tenant-scoped tree | RLS | tenant.suborgs.read/create/update/delete | sub-org CRUD | invariant-ready | /api/org/sub-organisations* | missing | n/a | sub-organisations unit tests | no admin UI | ADR-0021, ADR-0058 | ADR-ACT-0234 | capability-registry marks tenant_suborgs partial. |
| `rbac` | realm roles | realm boundary | TENANT_ROLES (tenant-admin/manager/member/viewer) | role-change audit | invariant-ready | members role routes | /admin/members | n/a | members tests | none | ADR-0021 | ADR-ACT-0237 | Delivered. |
| `abac-pdp` | per-resource policy in realm | policy stored in Keycloak realm | resource + umaScope on routes (pipeline PEP) | policy change via resource-policies usecase | invariant-ready | /api/auth/settings/resource-policies | partial (auth settings) | n/a | authorize-resource unit tests; proof:entitlement-policy-chain | no general ABAC attribute model beyond UMA scopes; the entitlement step of the chain is delivered (Phase 1) but real quota enforcement is Phase 2 | ADR-0058 | ADR-ACT-0242 | Decision: keep Keycloak UMA as PDP; do NOT add OPA unless an attribute-policy need is proven. |
| `delegated-admin-roles` | realm-scoped | realm boundary | to define | delegation grant/revoke audit (to build) | deferred | missing | missing | n/a | not-yet-proven | needs ADR before implementation | ADR-0058 | ADR-ACT-0242 | capability-registry marks delegated_admin_roles deferred; ADR-0058 to define. |
| `entitlements` | tenant-scoped entitlement set | RLS | tenant.entitlements.read (tenant); platform.entitlements.read/write (operator) | entitlement.granted / entitlement.revoked (audit-before-change) | to define | GET /api/org/entitlements; GET+PATCH /api/admin/tenants/:tenantId/entitlements | /admin/entitlements (operator console + tenant read-only) | tenant read-only entitlement view | proof:entitlements; proof:entitlement-policy-chain; proof:entitlements-postgres; proof:entitlements-routes | entitlement substrate is locally proven (live Postgres RLS + live BFF route handlers); real quota enforcement is still Phase 2 (only a hook); billing/metering not delivered | ADR-0057 | ADR-ACT-0241 | Phase 1 + 1.5 (ADR-ACT-0254/0255): entitlement engine LIVE-proven against Compose Postgres (RLS isolation — migration 023 fixed a real bypass-predicate flaw caught by the proof) and live BFF route handlers. Deny-by-default + audit-before-change + no-self-grant + evaluation chain + quota HOOK (Phase-2 only). Operator console picks a tenant via a lookup Select (no raw UUID). Billing/metering/real quotas not delivered. |
| `support-mode-breakglass` | scoped to one tenant; audited | session-scoped | platform.admin.access; resource platform:support, scope enter | support-session creation audited | n/a | POST /api/admin/support-session | partial | n/a | support-mode unit tests | no approval workflow; host-origin escalation deferred (per bedrock evidence) | ADR-0066 | ADR-ACT-0251 | Escalation on tenant hosts deferred pending an ADR (bedrock hardening evidence). |
| `privileged-access-audit` | tenant-scoped via RLS | RLS; metadata redaction (no secrets) | tenant.audit.read | self (this IS the audit trail) | invariant-ready | GET /api/org/audit | /admin/logs + audit panels | n/a | audit unit tests | none; retention policy not yet enforced | ADR-0040 | ADR-ACT-0237 | Delivered. |

### Authentication

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `platform-login` | locally proven | Browser login, HTTP-only cookie session, forward-auth. | keycloak (per-env), redis session, caddy forward_auth | build | Keycloak + Redis (composed) | per-environment | per-env | P0 | M | Low |
| `idp-brokering` | delivered | Per-tenant external IdP federation (OIDC). | keycloak; mock-oidc fixture | build | Keycloak brokering (composed) | per-environment | per-env | P0 | L | Medium |
| `claim-group-mapping` | partial | Map external IdP claims/groups to platform roles. | keycloak mappers | build | Keycloak (composed) | per-environment | per-env | P1 | M | Medium |
| `real-idp-login-proof` | blocked | Prove end-to-end login against a real external IdP. | mock-oidc cannot substitute (per memory + ADR-ACT-0220) | defer | none local; requires real Google/Microsoft/Okta tenant | production-external | production-external | P2 | M | Medium |
| `mfa-session-policy` | partial | Configurable MFA, session lifetime, account lockout/recovery. | keycloak | build | Keycloak (composed) | per-environment | per-env | P1 | M | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `platform-login` | FQDN-scoped session; realm per tenant model | session in Redis, token encrypted | n/a (establishes actor) | auth events | auth-credential readiness | /auth/login, /auth/callback, /auth/logout, /internal/auth/forward | n/a | login screen (custom KC theme) | auth-routes substrate tests; proof:auth-settings | real IdP login simulation blocked (see real-idp-proof) | ADR-0022 | ADR-ACT-0237 | Delivered/proven against mock-oidc. |
| `idp-brokering` | realm-scoped IdP config | client secrets write-only + redacted | tenant.auth.settings.read/write | AuthSettingsIdpChanged | idp-count + providers | /api/auth/settings/idps* | /admin/auth (IdP manager) | tenant-admin self-service | proof:auth-idps; proof:auth-oidc-enterprise | SAML not supported (OIDC only); claim/group mapping partial | ADR-0043, ADR-0046, ADR-0037 | ADR-ACT-0237 | OIDC delivered; SAML is a gap. |
| `claim-group-mapping` | realm-scoped | realm boundary | tenant.auth.settings.write | mapping change audit | deferred (capability-registry) | /api/auth/settings/idps/:alias/mapping | /admin/auth (partial) | partial | oidc-mapping unit tests | real-IdP mapping proof blocked (ADR-ACT-0220) | ADR-0046 | ADR-ACT-0220 | Machinery present; proof blocked on real IdP. |
| `real-idp-login-proof` | n/a | n/a | n/a | n/a | deferred | existing callback | n/a | n/a | blocked | no real IdP available in local stack | ADR-0046 | ADR-ACT-0220 | Explicitly blocked; mock-oidc fixture is not a substitute. |
| `mfa-session-policy` | realm-scoped policy | realm boundary | tenant.auth.settings.read/write | AuthSettingsMfaChanged/SessionChanged | credential-derived | /api/auth/settings/mfa, /session | /admin/auth (MFA + session tabs) | tenant-admin | proof:auth-settings; MFA-required E2E deferred (ADR-ACT-0158) | account lockout/recovery surface not exposed; MFA-required login E2E deferred | ADR-0042 | ADR-ACT-0158 | MFA/session writable + proven; lockout/recovery is a gap. |

### Configuration and tenant self-management

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant-config-registry` | delivered | Typed per-tenant config with env defaults, override, reset, audit. | postgres | build | Postgres (composed) | per-environment | per-env | P0 | M | Low |
| `branding-theme` | partial | Per-tenant theme tokens and branding. | postgres + /api/theme | build | built-in theme tokens (composed) | per-environment | per-env | P2 | S | Low |
| `custom-domains-dns-tls` | partial | Tenant-owned vanity domains with verified DNS, TLS, canonical redirect. | caddy on-demand TLS; DNS challenge; cloudflare adapter | build | Caddy + custom DNS challenge (composed); Cloudflare adapter for prod | per-environment | per-env (cert issuance prod-external via Cloudflare) | P1 | L | Medium |
| `secret-setting-writeonly` | delivered | Operators set credentials that are never read back. | postgres encrypted-at-rest; redaction in DTOs | build | built-in (token-crypto) | per-environment | per-env | P1 | S | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant-config-registry` | tenant override -> env default | RLS | tenant.config.read/write | config change audited; tenant.config.changed webhook event | invariant-ready | /api/org/config* | /admin/config | tenant-admin | platform-config + config-contracts tests | full point-in-time rollback partial (reset-to-default only) | ADR-0039 | ADR-ACT-0237 | Delivered; rollback history is a future enhancement. |
| `branding-theme` | per-tenant theme | RLS | tenant.config.read | config audit | invariant-ready | GET /api/theme | /admin/config (branding partial) | partial | local-caddy-routing theme proof | branding capability marked partial in registry | ADR-0029 | ADR-ACT-0237 | Theme delivered; rich branding partial. |
| `custom-domains-dns-tls` | domain claimed by one tenant; cross-tenant conflict rejected pre-token | RLS; domain-claim lifecycle | tenant.domains.read/write | domain lifecycle audited | tenant-domains readiness kind | /api/org/domains* | /admin/domains | tenant-admin | proof:tenant-domains; proof:tenant-domain-canonical; proof:tenant-domain-claim-lifecycle | public DNS verification blocked locally; canonical redirect cutover not proven | ADR-0048, ADR-0033 | ADR-ACT-0232 | Machinery live; public DNS + redirect cutover are honest gaps (bedrock evidence). |
| `secret-setting-writeonly` | tenant-scoped | encrypted; never returned | per-surface write perms | metadata-only audit (never secret) | n/a | email/idp/credential routes | write-only fields | tenant-admin | token-crypto + auth-settings-audit tests | no central secrets manager (Vault) — env/db only | ADR-0043, ADR-0041 | ADR-ACT-0237 | Pattern delivered; a Vault/KMS adapter is a later production hardening. |

### Billing, metering, and entitlements

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `product-catalog-plans-prices` | missing | Define sellable products, plans, and pricing. | none | compose | Lago (OSS) or Kill Bill; OpenMeter for usage | per-environment | per-env | P1 | XL | High |
| `subscriptions-invoices-payments` | missing | Lifecycle of paid subscriptions including invoicing and dunning. | none | compose | Lago/Kill Bill (OSS); payment gateway is prod-external adapter | per-environment | per-env | P2 | XL | High |
| `metering-usage-meters` | locally proven | Ingest usage events and aggregate into meters. | built-in Postgres meter_events (migration 024); ClickHouse available for the later provider | build | built-in Postgres meter store; OpenMeter/ClickHouse provider behind MeteringRepository is Phase 2.5 | per-environment | per-env | P1 | L | High |
| `quota-enforcement` | locally proven | Enforce per-tenant limits derived from plan/entitlement. | built-in tenant_quotas (migration 024) + meter aggregation; no Redis required for the proof | build | built-in quota check using entitlements + windowed meter aggregation | per-environment | per-env | P1 | M | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `product-catalog-plans-prices` | catalog global; subscription per-tenant | billing provider DB + local mirror | platform.billing.* / tenant.billing.read | plan/price change audit | to define | missing | missing | missing | not-yet-proven | no billing engine composed or adapted | ADR-0057 | ADR-ACT-0241 | Discovery first: Lago vs OpenMeter vs Kill Bill vs custom ledger. |
| `subscriptions-invoices-payments` | subscription per-tenant | provider + local mirror; PCI handled by gateway | tenant.billing.* | billing ledger (immutable) | to define | missing | missing | missing (billing portal) | not-yet-proven | payment provider is paid/external; no local payment proof possible | ADR-0057 | ADR-ACT-0241 | Payment capture is the only place a paid external adapter is unavoidable; everything else proven locally. |
| `metering-usage-meters` | tenant-scoped meter_events with RLS (migration 024) | RLS + idempotency unique (org, meter, idempotency key) | tenant.metering.read (tenant); platform.metering.read/write (operator) | n/a (meter events are the data; quota changes are audited) | n/a (always-on once built) | POST /api/admin/tenants/:tenantId/meter-events; GET /api/org/usage; GET /api/admin/tenants/:tenantId/usage | /admin/usage (operator console + tenant read-only) | tenant read-only usage view | proof:metering; proof:metering-quota-routes | built-in Postgres meter store live-proven; high-volume ClickHouse/OpenMeter provider is Phase 2.5 (behind the port) | ADR-0067, ADR-0061 | ADR-ACT-0245 | Phase 2 (ADR-ACT-0256): built-in Postgres metering — RLS-isolated, idempotent, windowed aggregation, entitlement-gated ingestion — live-proven (proof:metering). ClickHouse/OpenMeter providerisation is Phase 2.5 behind MeteringRepository. |
| `quota-enforcement` | tenant-scoped tenant_quotas with RLS (migration 024) | RLS; usage aggregated from RLS-scoped meter_events | enforced at BFF after permission + entitlement; tenant.metering.read / platform.quotas.read\|write | quota.set / quota.removed (audit-before-change) | n/a (always-on once built) | GET /api/org/quotas; GET+PATCH /api/admin/tenants/:tenantId/quotas | /admin/usage (operator set-quota + tenant read-only) | tenant read-only quota/usage view | proof:quota-enforcement; proof:metering-quota-routes | live-proven against Postgres; denial returns a typed 403 (429 semantics a later refinement) | ADR-0067 | ADR-ACT-0241 | Phase 2 (ADR-ACT-0256): real quota enforcement (entitlement → usage-vs-limit over a window) replaces the Phase-1 no-op hook; entitlement is checked BEFORE quota; quota changes audited; live-proven (proof:quota-enforcement). |

### Data platform

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `relational-storage` | locally proven | Transactional data with schema lifecycle and tenant isolation. | postgres (per-env), db-migrate | build | Postgres (composed) | per-environment | per-env | P0 | M | Low |
| `backup-restore` | locally proven | Recoverable backups of tenant data. | postgres-backup.sh / postgres-restore.sh | build | pg_dump + MinIO sink (composed) | per-environment | per-env | P1 | M | High |
| `pitr-retention-legalhold-residency` | missing | Point-in-time recovery, retention enforcement, legal hold, residency controls. | none (Sentry has its own 90d cleanup only) | build | Postgres WAL archiving + pgBackRest (OSS) | per-environment | per-env | P2 | L | High |
| `data-governance-catalog-lineage-pii-dsr` | missing | Catalog, classify, trace, and satisfy data-subject requests. | none | compose | OpenMetadata or DataHub (OSS) | shared-cross-environment | shared (engineering metadata, not tenant runtime data) — requires partitioning proof | P2 | XL | High |
| `import-export` | missing | Bulk import and export of tenant data. | none | build | built-in jobs writing to MinIO | per-environment | per-env | P2 | M | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `relational-storage` | schema-per-tenant + RLS | RLS; non-superuser app role (ADR-ACT-0189) | server-only; no direct DB from React | migrations tracked | postgres probe | all data via BFF/GraphQL | pgAdmin (global-only clickthrough) | n/a | postgres repository substrate tests | none for core; PITR/residency separate rows | ADR-0014, ADR-0029 | ADR-ACT-0237 | Delivered/proven foundation. |
| `backup-restore` | full-DB backup; per-tenant export separate | umask 077 chmod 600; refuses non-dev/test without ALLOW_BACKUP_ENV | operator scripts | n/a | proof:backup-local | n/a (ops scripts) | n/a | n/a | proof:backup-local | no scheduled/offsite backup; no production restore drill | ADR-0064 | ADR-ACT-0248 | Local scripts proven; production backup/restore lifecycle is the gap. |
| `pitr-retention-legalhold-residency` | policy per tenant/region | WAL archive; retention jobs | platform.data.* | retention/legal-hold actions audited | to define | missing | missing | missing | not-yet-proven | no PITR, retention, legal hold, or residency machinery | ADR-0064, ADR-0063 | ADR-ACT-0248 | Compliance-driven; pairs with data governance. |
| `data-governance-catalog-lineage-pii-dsr` | catalog is metadata; DSR workflows tenant-scoped | metadata only; DSR acts on per-tenant data | platform.governance.* / tenant DSR | DSR fulfilment audited | to define | missing | missing | missing (DSR intake) | not-yet-proven | no catalog, lineage, classification, PII discovery, or DSR workflow | ADR-0063 | ADR-ACT-0247 | Catalog may be shared if metadata-only; DSR must be per-tenant. |
| `import-export` | tenant-scoped export | RLS + signed download | tenant.data.export | export audited | to define | missing | missing | missing | not-yet-proven | absent; pairs with tenant deletion/portability | ADR-0063 | ADR-ACT-0247 | Needed for tenant offboarding + GDPR portability. |

### Search

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `search-indexing` | locally proven | Tenant-scoped, permission-aware full-text and filtered search. | postgres (search_documents, RLS, GIN tsvector) | build | Postgres full-text search (built-in); Meilisearch/Typesense are Phase-4.5 behind the ports | per-environment | per-env | P1 | L | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `search-indexing` | documents tenant-scoped (RLS); queries run under withTenant | RLS; permission_key query filter; no secret fields indexed/returned | tenant.search.read; platform.search.read/write | search.reindexed (operator, audit-before-change) | operator search-readiness (postgres-fts; never faked) | /api/org/search; /api/admin/search/readiness; /api/admin/search/reindex | /admin/search | tenant search test (read) | proof:search; proof:search-isolation; proof:search-routes | composed engine (Phase 4.5) for typo-tolerance/relevance at scale; indexing producers wired per-capability | ADR-0060 | ADR-ACT-0258 | Phase 4 delivered + live-proven: built-in Postgres FTS, RLS-isolated + permission-aware. Composed engine (Meilisearch/Typesense/OpenSearch) is Phase 4.5 behind SearchIndexPort/SearchQueryPort. |

### Storage

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `object-storage` | partial | S3-compatible storage with tenant isolation and signed access. | minio (per-env); storage-runtime real port; tenant-storage usecase | build | MinIO (composed); real S3 adapter for prod (ADR-ACT-0223) | per-environment | per-env (object data is environment-specific) | P1 | L | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `object-storage` | per-tenant prefix; isolation probe | bucket/prefix policy; isolation_failed status | tenant.storage.read/write | storage ops (partial) | tenant-storage readiness kind | /api/org/storage/readiness, /probe | /admin/storage (readiness only, no browser) | partial | proof:tenant-storage (live MinIO) | no file CRUD API/UI, no quotas, lifecycle, AV scan, or legal hold | ADR-0049, ADR-0064 | ADR-ACT-0223 | Readiness + isolation proven; storage product (browser, quotas, lifecycle) is the gap. |

### Events, queues, and workflows

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `event-bus-queues-dlq` | locally proven | Internal eventing, durable job queues, dead-letter + redrive. | postgres outbox (platform_events + event_dead_letters, RLS) | build | Postgres outbox (built-in); Redis Streams/NATS are Phase-5.5 behind the port | per-environment | per-env (Sentry Kafka is Sentry-only, not the platform bus) | P1 | L | Medium |
| `workflow-engine-scheduled-jobs` | missing | Durable orchestration of long-running and scheduled work with visibility. | single webhook worker only; no general scheduler/engine | compose | Temporal (heavy) or Windmill (light) — both OSS local | per-environment | per-env | P1 | XL | High |
| `notifications` | missing | Deliver notifications across email/in-app/push/SMS with per-user preferences. | notification-runtime PORT-ONLY scaffold; email-runtime + mailpit exist for email | compose | Novu (OSS) or ntfy; local SMTP via Mailpit; webhook adapter | per-environment | per-env | P1 | L | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `event-bus-queues-dlq` | events + dead letters tenant-scoped (RLS) | RLS; idempotent by (org,type,key); no secret payload fields | platform.events.read/write (operator-only) | event.redriven (audit-before-change) | operator events/DLQ + worker liveness | /api/admin/events; /api/admin/events/dead-letter; /api/admin/events/:eventId/redrive | /admin/events | n/a (operator-only) | proof:event-bus; proof:event-redrive | composed bus (Phase 5.5) for high throughput; retry-backoff schedule | ADR-0059, ADR-0051, ADR-0052 | ADR-ACT-0259 | Phase 5 delivered + live-proven: Postgres outbox + DLQ/redrive. Composed Redis/NATS bus is Phase 5.5 behind EventBusPort; workflow engine is gated on this substrate. |
| `workflow-engine-scheduled-jobs` | tenant-scoped workflow namespaces | engine DB per-env | platform.workflow.* / tenant.workflow.read | workflow transitions audited | to define (engine health) | missing | missing (workflow visibility) | missing | not-yet-proven | no engine, scheduler, approval workflow, or visibility | ADR-0059 | ADR-ACT-0243 | Windmill favoured for low burden; Temporal if durable long-running guarantees needed. |
| `notifications` | tenant + user scoped | per-tenant notification store | self + tenant.notifications.* | notification send logged | to define | email-sender routes only; no general notification API | missing (notification centre) | missing (preferences) | proof:email-sender (email channel only) | only transactional email delivered; multi-channel + preferences absent | ADR-0059, ADR-0047 | ADR-ACT-0249 | Email channel proven via Brevo/SMTP/Mailpit; Novu for in-app/push if needed. |

### Compute and application runtime

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `background-workers-runtime` | locally proven | Run scheduled and async work reliably with retries. | postgres (worker_heartbeats) + durable claim loop | build | built-in worker runtime (Postgres claim + heartbeat) | per-environment | per-env | P2 | M | Medium |
| `serverless-functions` | missing | Tenant- or platform-authored functions on demand. | none | defer | Windmill scripts or OpenFaaS (OSS) — only if a real need emerges | per-environment | per-env | P3 | XL | High |
| `runtime-secrets` | partial | Central, audited secret storage and rotation. | env + db encryption; LocalStack secretsmanager is a MOCK only | compose | Vault OSS (local dev) or a local KMS abstraction | per-environment | per-env | P2 | M | High |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `background-workers-runtime` | n/a (cross-tenant system worker; events claimed RLS-bypass, tenant id preserved on each event) | worker_heartbeats is global infra (no tenant data) | platform.workers.read (operator-only) | n/a (heartbeats are operational telemetry) | worker heartbeat liveness (alive/stale/stopped) | /api/admin/workers | /admin/events | n/a | proof:event-worker | single-process claim loop; horizontal scaling + scheduler are Phase 5.5+ | ADR-0059, ADR-0055 | ADR-ACT-0259 | Phase 5 delivered + live-proven: durable claim/process/retry/DLQ with FOR UPDATE SKIP LOCKED + persisted heartbeats. Idempotent processing (processed events never re-claimed). |
| `serverless-functions` | sandboxed per tenant | function-scoped | function-level perms | invocation audit | n/a | missing | missing | missing | not-yet-proven | no runtime; high security surface | ADR-0055 | ADR-ACT-0239 | Deferred until a concrete product need; large security surface. |
| `runtime-secrets` | path-scoped per tenant | encrypted; access-controlled | platform.secrets.* | secret access audited | to define | n/a (infra) | missing | n/a | token-crypto (app-level) only | no central secrets manager; secrets via env/db | ADR-0055, ADR-0031 | ADR-ACT-0239 | LocalStack secretsmanager is mock-only; do not treat as production substrate. |

### Observability and operations

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `logs` | locally proven | Structured log ingestion and tenant-scoped search. | loki + alloy + grafana (observability profile, per-env) | build | Grafana Loki + Alloy (composed) | per-environment | per-env | P0 | M | Low |
| `metrics-traces` | partial | Metric and trace collection with a queryable backend. | otel-collector (per-env); NO Prometheus, NO Tempo/Jaeger | compose | Prometheus + Tempo (OSS) behind the existing OTEL collector | per-environment | per-env | P1 | L | Medium |
| `alerting-incident-oncall` | missing | Alert rules, incident lifecycle, escalation, and public status. | grafana exists but no Alertmanager; no incident tool | compose | Grafana Alerting + Alertmanager (OSS); status page via custom + readiness API | shared-cross-environment | shared (engineering ops) with env labels; tenant comms separate | P1 | L | High |
| `service-catalog-readiness` | locally proven | Inventory of platform services with honest health/readiness. | platform-services registry (17 services) + readiness probes | build | built-in (composed) | per-environment | per-env | P1 | S | Low |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `logs` | tenant-scoped log query (admin logs) | label-based; query API enforces scope | platform.logs.read / tenant.audit.read | n/a | loki probe; observability readiness | GET /api/admin/logs/search; /api/org/observability/readiness | /admin/logs; Grafana clickthrough (global-only) | tenant log view | proof:tenant-observability; logs-usecase tests | Loki filesystem storage (prod needs S3 backend) | ADR-0035, ADR-0050 | ADR-ACT-0246 | Delivered/proven for logs. |
| `metrics-traces` | tenant/env labels on telemetry | label-based | operator | n/a | observability readiness signals (metrics/traces status) | observability readiness route | /admin/observability (signal status only) | n/a | observability-smoke; proof:tenant-observability | OTEL collector ingests but no metrics/trace backend or dashboards | ADR-0062, ADR-0020 | ADR-ACT-0246 | Collector is the seam; add Prometheus+Tempo backends. |
| `alerting-incident-oncall` | alerts tagged by env/tenant; tenant comms scoped | label-based; access-controlled | platform.ops.* | incident actions audited | service readiness already exists internally | platform services readiness (internal); no incident API | /admin/platform (readiness); no incident UI | missing (public status page) | proof:platform-services (readiness only) | no alert rules, notification channels, SLOs, incident lifecycle, on-call, or status page | ADR-0062 | ADR-ACT-0246 | Readiness != alerting. Grafana running != incident management. |
| `service-catalog-readiness` | host authority (tenant vs system operator) | no secrets in payload; allowlisted console URLs | tenant.platform.read | n/a | 8-value honest status vocabulary | GET /api/org/platform/services/readiness | /admin/platform | n/a | proof:platform-services; proof:service-clickthrough-policy | point-in-time only; no history | ADR-0062 | ADR-ACT-0246 | Delivered/proven; foundation for alerting/incident. |

### Security and governance

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `code-quality-secret-dep-scan` | partial | Engineering-quality and supply-chain scanning. | sonarqube (shared, react-sonar); gitleaks in CI; semgrep rules | build | SonarQube (composed shared) + gitleaks + semgrep + dependency-check | shared-cross-environment | shared (engineering quality, not tenant runtime data) | P2 | M | Low |
| `compliance-evidence-access-reviews` | partial | Generate compliance evidence and run periodic access/role reviews. | docs/evidence governance + audit_events | build | built-in (audit + evidence) | per-environment | per-env (tenant); governance docs shared | P2 | L | Medium |
| `tenant-isolation-proof` | locally proven | Demonstrable cross-tenant isolation across data and routing. | RLS + FQDN routing + storage isolation probe | build | built-in proofs | per-environment | per-env | P0 | M | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `code-quality-secret-dep-scan` | n/a (code, not tenant data) | single react-sonar project | admin:sonarqube clickthrough (global-only) | n/a | sonarqube probe (status UP) | n/a (CI) | Sonar clickthrough (global-only) | n/a | semgrep:gate; CI gitleaks (recent commit) | dependency scanning not yet a hard gate | ADR-0016 | ADR-ACT-0247 | Sonar legitimately shared: it holds engineering-quality data, not tenant runtime data, so there is no tenant data to leak across environments. Sentry is shared errors-only with env/tenant tagging and retention boundaries. |
| `compliance-evidence-access-reviews` | tenant-scoped audit feeds reviews | RLS on audit | platform.compliance.* | review completion audited | to define | audit read only; no review/report API | audit panels only | n/a | evidence-bundle governance; audit tests | no compliance report generation, access-review or role-review workflow | ADR-0063 | ADR-ACT-0247 | Audit trail is the raw material; reviews/reports are missing. |
| `tenant-isolation-proof` | the subject itself | RLS + schema-per-tenant + prefix isolation | enforced server-side | n/a | n/a | host-identity + readiness | n/a | n/a | proof:domain-identity-matrix; proof:tenant-storage isolation | shared services (Sentry/Sonar/Grafana/Mailpit) have NO per-tenant isolation — global-only by policy | ADR-0029 | ADR-ACT-0247 | Core data/routing isolation proven; shared-tool isolation gaps are explicit in clickthrough policy. |

### Developer platform

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks-developer` | locally proven | Outbound event subscriptions with signing, delivery, redrive, metrics. | webhooks usecase + delivery worker | build | built-in (composed) | per-environment | per-env | P0 | M | Low |
| `api-docs-portal-sdk-ratelimits` | partial | Self-serve developer experience: docs, portal, SDKs, rate-limited keys, sandbox. | openapi.json baseline; GraphQL primary; no portal | compose | Redocly/Swagger UI (docs) + Backstage or Kong OSS (portal/gateway) | per-environment | per-env | P2 | L | Medium |
| `rate-limiting` | locally proven | Per-tenant request rate limits over a fixed window, entitlement-gated. | postgres (rate_limit_policies + rate_limit_counters, RLS) | build | Postgres fixed-window counter (built-in); Redis is Phase 3.5 behind the port | per-environment | per-env | P1 | M | Medium |
| `mock-providers` | mock-only | Deterministic mocks for external dependencies in dev/test. | wiremock (external-mocks), localstack (cloud-mocks), mock-oidc (identity-mocks) | build | WireMock / LocalStack / mock-oidc (composed) | mock-only | mock-only | P0 | S | Low |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webhooks-developer` | tenant-scoped subscriptions | RLS; secret returned once | tenant.webhooks.* | delivery + redrive audited | tenant-webhooks readiness kind | /api/org/webhooks* | /admin/webhooks | tenant-admin | proof:webhooks; proof:webhook-redrive | none | ADR-0051, ADR-0052 | ADR-ACT-0250 | Delivered/proven; cornerstone of developer platform. |
| `api-docs-portal-sdk-ratelimits` | scoped API keys (depends on api-keys-pat) | n/a (docs) / per-tenant keys | tenant.developer.* | key + app changes audited | to define | openapi.json (drift not enforced); GraphQL | missing (portal) | missing | openapi:drift (not complete) | no external portal, SDK gen, sandbox/test mode, or schema-level OpenAPI drift (rate limits now delivered — see `rate-limiting`) | ADR-0065 | ADR-ACT-0257 | OpenAPI baseline + path/method drift enforced; rate limits delivered as the `rate-limiting` capability (Phase 3); external portal/SDK/sandbox remain gaps (ADR-0065 Proposed sub-decisions). |
| `rate-limiting` | policies + counters tenant-scoped (RLS) | RLS; no secret fields | tenant.developer.read; platform.rate_limits.read/write | rate_limit.set (audit-before-change) | n/a (always-on once built) | /api/org/rate-limits; /api/admin/tenants/:tenantId/rate-limits | /admin/developer | tenant read-only | proof:rate-limits; proof:api-key-routes | Redis-backed limiter (Phase 3.5) recommended before sub-second/high-volume load | ADR-0065 | ADR-ACT-0257 | Phase 3 delivered + live-proven. Reuses the entitlement substrate (entitlement before limit), the bridge to the quota model (ADR-0067). |
| `mock-providers` | n/a | no real data permitted | wiremock not_exposed; localstack global-only (dev/staging) | n/a | service probes | n/a | LocalStack clickthrough (global-only); WireMock direct-only | n/a | service readiness | FORBIDDEN in production | ADR-0017 | ADR-ACT-0238 | Must never be treated as production substrate; forbidden-in-production. |

### Support and enterprise administration

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant-lifecycle-suspend-delete-export` | partial | Full lifecycle management of a tenant including suspension and deletion. | provisioning delivered; no suspend/delete/export | build | built-in (composed) | per-environment | per-env | P1 | L | High |
| `support-tickets-health-comms` | missing | Support desk, tenant health signals, incident communication, announcements. | none | compose | Zammad or Chatwoot (OSS) for tickets; built-in announcements | shared-cross-environment | shared (support desk) with tenant tagging + access control | P2 | L | Medium |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tenant-lifecycle-suspend-delete-export` | operates on one tenant | delete must purge schema + storage + realm | platform.tenants.* | lifecycle transitions audited | n/a | POST /api/admin/tenants (create only) | partial (provision) | n/a | tenant provisioning tests | no suspend, delete, or export; deletion must coordinate data + storage + realm + DSR | ADR-0066, ADR-0063 | ADR-ACT-0251 | Deletion/offboarding couples with data governance + import-export. |
| `support-tickets-health-comms` | tickets tagged + access-scoped by tenant | support tool DB; tenant tag mandatory | platform.support.* | support actions audited | to define | missing | missing | missing | not-yet-proven | no ticketing, health, comms, or announcements | ADR-0066 | ADR-ACT-0251 | If shared, tenant tagging + retention + access control are mandatory. |

### Foundation (cross-cutting governance)

| Capability | Status | Purpose | Compose / provider | Decision | Local free candidate | Environment model | Shared/per-env | Priority | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `usf-scope-boundary` | delivered | Define what the foundation is and is not; prevent fake-readiness and scope creep. | n/a (governance) | build | n/a | not-applicable | n/a | P0 | S | Low |
| `build-vs-compose-framework` | delivered | A repeatable rubric for build/compose/adapter/defer/reject per capability. | n/a | build | n/a | not-applicable | n/a | P0 | S | Low |
| `service-catalog-provider-model` | partial | How services are registered, classified, probed, and adapted to providers. | platform-services + clickthrough policy registries exist | build | built-in registries (composed) | per-environment | per-env | P0 | M | Low |
| `environment-service-classification` | delivered | Classify every service per-env/shared/mock/forbidden with isolation guarantees. | compose profiles already encode much of this | build | n/a (governance) | not-applicable | n/a | P0 | S | Low |

| Capability | Tenant isolation | Data isolation | Permission | Audit events | Readiness model | BFF contract | Admin UI | Self-service UI | Proof | Production blockers | ADR | ADR-ACT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `usf-scope-boundary` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | this matrix + registry + validation test | none (decision artifact) | ADR-0053 | ADR-ACT-0237 | This deliverable. Status reflects the planning artifact, not the foundation. |
| `build-vs-compose-framework` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | docs/architecture/build-versus-compose-decision-framework.md | none | ADR-0054 | ADR-ACT-0240 | Framework doc delivered in this pass. |
| `service-catalog-provider-model` | host authority in catalog | no secrets exposed | tenant.platform.read | n/a | service readiness | platform services readiness; GET /api/platform/service-catalog (catalog v2) | /admin/platform | n/a | proof:platform-services; proof:service-clickthrough-policy; proof:service-catalog-registry; proof:entitlements-routes | catalog v2 seam + provider registry + no-mock-in-production invariant delivered (static seed); full generalisation of platform-services/service-clickthrough into the catalog is incremental | ADR-0055 | ADR-ACT-0239 | Phase 1 (ADR-ACT-0254): service catalog v2 seam + provider registry port + buildServiceCatalog filtering + forbiddenProvidersForEnvironment invariant, proven via proof:service-catalog-registry. Generalising the existing registries fully is incremental. |
| `environment-service-classification` | shared services require tagging + access + retention | leakage analysis required for shared services | clickthrough policy | n/a | n/a | n/a | n/a | n/a | docs/architecture/environment-service-classification.md | none (decision artifact) | ADR-0056 | ADR-ACT-0238 | Classification doc delivered in this pass. |

<!-- USF-TABLE:END -->

## Phase 4 — environment model

Every candidate service is classified per the controlled vocabulary in
[`environment-service-classification.md`](../../architecture/environment-service-classification.md):
`per-environment`, `shared-cross-environment`, `local-only`, `test-only`, `mock-only`,
`production-external`, `production-internal`, `forbidden-in-production`.

Reasoning that governs the classification:

- **Per-environment (default for tenant runtime data):** Postgres, Redis, MinIO, ClickHouse (product analytics), Keycloak, platform-api, React/Caddy, Loki/Grafana/Alloy. Tenant state, migrations, object data, and realm configuration are environment-specific. A new search engine, workflow engine, metering store, and metrics/trace backend inherit this default because they hold or derive tenant runtime data.
- **Shared-cross-environment (only for non-tenant-runtime data, with guards):** SonarQube (engineering quality, `react-sonar`), Sentry (errors-only, `react-sentry`, env/tenant tagged). A shared service is permitted **only** if it provides: environment tagging, tenant tagging where tenant data exists, access controls, retention controls, a backup/restore/deletion model, an audit model, a readiness proof, and a written data-leakage analysis. Candidate shared additions (data catalog metadata, support desk, alerting) must satisfy the same checklist before they are composed.
- **Mock-only / forbidden-in-production:** WireMock, LocalStack, mock-oidc. These must never be treated as production substrate. LocalStack's `secretsmanager` is a mock and is explicitly **not** the secrets-management capability.
- **Production-external:** real payment gateway, real external IdPs (real-IdP login proof is `blocked` locally), Cloudflare certificate issuance for custom domains.

Sentry's internal ClickHouse and Kafka are **shared with Sentry only** and must not be treated as the platform analytics warehouse or the platform event bus.

## Phase 5 — ADR and action-register plan

Proposed ADRs (created as `Proposed` stubs in this pass): ADR-0053 (scope + principles), ADR-0054 (build-vs-compose framework), ADR-0055 (service catalog + provider model), ADR-0056 (environment-specific vs shared model), ADR-0057 (entitlement/billing/quota), ADR-0058 (PDP + delegated administration), ADR-0059 (workflow/event/queue), ADR-0060 (search/indexing), ADR-0061 (analytics/metering), ADR-0062 (observability/alerting/incident), ADR-0063 (data governance/compliance), ADR-0064 (backup/recovery/retention/legal hold), ADR-0065 (developer platform/API management), ADR-0066 (support administration/break-glass).

Action-register rows opened: ADR-ACT-0237 (this matrix) through ADR-ACT-0251. See `docs/adr/ACTION-REGISTER.md`. Each row links back to the capabilities above via the `ADR-ACT` column in the governance table.

## Phase 6 — prioritization (by foundation dependency, not visual appeal)

1. **Universal matrix + scope boundary (ADR-ACT-0237, ADR-0053).** Unlocks every later decision; blocks nothing but premature implementation. Done in this pass.
2. **Service catalog + provider model (ADR-ACT-0239, ADR-0055).** Generalises the existing service/clickthrough registries into a provider-adapter catalog. Unlocks consistent integration of every composed service.
3. **Environment model (ADR-ACT-0238, ADR-0056).** Locks per-env/shared/mock/forbidden classification before any new service is composed. Blocks unsafe shared services.
4. **Entitlement + policy substrate (ADR-ACT-0241/0242, ADR-0057/0058).** Entitlements gate features and quotas; the PDP (Keycloak UMA today) governs access. Blocks billing UI and quota enforcement. Policy work can proceed in parallel with entitlements.
5. **Metering + billing architecture (ADR-ACT-0245/0241, ADR-0061/0057).** Metering (OpenMeter on the existing ClickHouse) precedes billing. Payment capture is the only production-external paid dependency.
6. **Workflow / event substrate (ADR-ACT-0243, ADR-0059).** Generalise the proven webhook delivery/redrive substrate into internal eventing + a workflow engine. Unlocks long-running jobs, approvals, and async notifications.
7. **Search / indexing substrate (ADR-ACT-0244, ADR-0060).** Independent; can run in parallel with 4–6.
8. **Notification substrate (ADR-ACT-0249, ADR-0059).** Builds on eventing; email channel already proven.
9. **Analytics substrate (ADR-ACT-0245, ADR-0061).** Shares ClickHouse with metering.
10. **Observability / alerting / incident substrate (ADR-ACT-0246, ADR-0062).** Metrics+traces backends, then alerting, then incident/on-call/status. Readiness catalog already delivered.
11. **Data governance + backup/recovery (ADR-ACT-0247/0248, ADR-0063/0064).** Retention, legal hold, residency, DSR; production backup/restore lifecycle.
12. **Support/admin + developer portal (ADR-ACT-0250/0251, ADR-0065/0066).** Tenant lifecycle (suspend/delete/export), API keys/portal, support desk, break-glass approval.
13. **Production-ready UI system + page templates.** Safe to start now for delivered/partial control-plane capabilities; universal-provider UI must wait for its backing substrate per item.
14. **Production/staging proof ladder.** Extend the existing `make all` confidence ladder (ADR-0034) to each new substrate as it lands.

## Phase 8 — validation of this artifact

`npm run usf:validate` asserts: every row has a status and a build/compose decision; every row has an environment classification; every shared service carries isolation/leakage notes; every production candidate names a local free path; nothing marked `delivered`/`locally proven` lacks a route/contract or proof reference; every `ADR-NNNN` resolves to a file; every `ADR-ACT` row is present in the register and linked here. The same checks run under `npm run test:architecture`.
