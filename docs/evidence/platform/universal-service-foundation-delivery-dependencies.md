# Universal Service Foundation — delivery dependency graph

- **Action:** ADR-ACT-0252 (delivery hardening)
- **Source ADRs:** ADR-0053 through ADR-0066 (Proposed)
- **Date:** 2026-06-13
- **Status of this document:** governance / planning artifact. It orders implementation; it does **not** claim any capability is delivered.

## Purpose

The [matrix](./universal-service-foundation-matrix.md) and [registry](./universal-service-foundation-registry.json) say *what* each capability is and *whether* it exists. This document says **in what order** the missing and partial capabilities must be built, and **why** — so the first real delivery slice is safe to start and later slices do not get blocked by something that should have come first.

It is **source-driven**. The dependency edges and phase assignment live in the registry's `delivery` block (`dependencies`, `phaseOrder`, `requiredDependencyTruths`). The table below is generated from that data and is checked by `npm run usf:validate`, which enforces:

- every capability has exactly one phase + dependency row;
- every `dependsOn` / `parallelWith` reference resolves to a real capability;
- the `dependsOn` graph is acyclic (no contradictory ordering);
- every required dependency truth (below) holds, transitively.

`Blocks` is **derived** as the inverse of `dependsOn`, so the two can never disagree.

## Required dependency truths (mechanically enforced)

These orderings are locked in `delivery.requiredDependencyTruths` and fail the build if violated:

1. **Entitlements precede billing UI and quota enforcement.** (`product-catalog-plans-prices`, `quota-enforcement` → `entitlements`)
2. **Service catalog precedes generic provider composition.** (`search-indexing`, `workflow-engine-scheduled-jobs`, `metering-usage-meters`, `metrics-traces` → `service-catalog-provider-model`)
3. **Policy model precedes delegated admin and API keys.** (`delegated-admin-roles`, `api-keys-pat` → `abac-pdp`)
4. **API keys precede the developer portal and rate limits.** (`api-docs-portal-sdk-ratelimits` → `api-keys-pat`)
5. **Metering precedes usage billing and quotas.** (`quota-enforcement`, `product-catalog-plans-prices` → `metering-usage-meters`)
6. **Queue/event substrate precedes workflow orchestration.** (`workflow-engine-scheduled-jobs` → `event-bus-queues-dlq`)
7. **Notification substrate precedes incident escalation.** (`alerting-incident-oncall` → `notifications`)
8. **Profile self-service precedes notification preferences.** (`notifications` → `end-user-profile-self-service`)
9. **Data governance precedes tenant deletion/export and DSR.** (`tenant-lifecycle-suspend-delete-export` → `data-governance-catalog-lineage-pii-dsr`)
10. **Backup/recovery precedes production tenant-lifecycle confidence.** (`tenant-lifecycle-suspend-delete-export` → `backup-restore`)
11. **Metrics/traces precede alerting/SLOs.** (`alerting-incident-oncall` → `metrics-traces`)
12. **Search indexing precedes product search UI.** (`search-indexing.mustPrecedeUi`)

Two further orderings are implicit in the bundled rows and stated here for completeness:

- **Alerting precedes incident/on-call.** Both live in the single `alerting-incident-oncall` row; the row's own internal sequence is alerting rules → notification channels → incident lifecycle → on-call → status page (see roadmap Phase 7).
- **Import/export precedes safe tenant deletion.** (`tenant-lifecycle-suspend-delete-export` → `import-export`)

## The critical path

The longest hard-dependency chain — and therefore the spine of the whole roadmap — is:

```text
service-catalog-provider-model
  → entitlements
    → metering-usage-meters
      → quota-enforcement
        → subscriptions-invoices-payments   (with product-catalog-plans-prices + workflow)
```

and, in parallel, the eventing spine that most product capabilities sit on:

```text
webhooks-developer (delivered)
  → event-bus-queues-dlq
    → workflow-engine-scheduled-jobs
      → import-export → data-governance → tenant-lifecycle (delete/export)
```

Nothing in billing, governance, lifecycle, or the developer portal can be honestly delivered before its prefix of these chains exists. This is why **Phase 1 (service catalog + entitlement + policy)** is the only correct place to start real implementation.

## Tracks that can run in parallel

Independent of the critical path (subject only to the service catalog being in place):

- **Search** (`search-indexing`) — parallel with entitlements/policy; only needs the service catalog.
- **Policy** (`abac-pdp`) — parallel with entitlements; only needs `rbac` (delivered).
- **Metrics/traces** (`metrics-traces`) — parallel with the billing chain; only needs the service catalog. (Alerting then waits for both metrics *and* notifications.)
- **Backup/recovery** (`backup-restore` → `pitr-…`) — parallel with most of the roadmap; only needs `relational-storage` (delivered). Must land before tenant deletion.

## Gates

- **Must precede compose** (`mustPrecedeCompose = Y`): the governance trio (`usf-scope-boundary`, `build-vs-compose-framework`, `environment-service-classification`) and `service-catalog-provider-model` must be in place before *any* new service is added to `compose.yaml`. Per-service compose work (`search-indexing`, `workflow-engine-scheduled-jobs`, `metering-usage-meters`, `metrics-traces`, `alerting-incident-oncall`, `notifications`, `data-governance…`, `pitr…`, `runtime-secrets`, billing engine, support desk) also carries this gate so it cannot be composed before its backing decision is hardened.
- **Must precede UI** (`mustPrecedeUi = Y`): the backing capability must exist before its admin/self-service UI is built. Building a billing screen, a search box, a notification-preferences pane, a DSR intake form, or a status page before its substrate exists would be fake-readiness by construction.

## Full dependency graph (generated)

<!-- Regenerate: `node -e` over delivery block; source of truth is the registry `delivery` field. Do not hand-edit; edit the registry and re-derive. -->

| Capability | Phase | Track | Depends on | Blocks (derived) | Parallel with | Pre-UI | Pre-compose | Risk if delayed |
| --- | --- | --- | --- | --- | --- | :-: | :-: | --- |
| `branding-theme` | delivered | delivered | `tenant-config-registry` | — | — | — | — | Theme delivered; rich branding remains partial. |
| `claim-group-mapping` | delivered | delivered-partial | `idp-brokering` | — | — | — | — | Machinery present; real-IdP mapping proof is blocked (ADR-ACT-0220). |
| `code-quality-secret-dep-scan` | delivered | delivered-partial | — | — | — | — | — | Sonar/gitleaks/semgrep present; dependency scanning not yet a hard gate. |
| `custom-domains-dns-tls` | delivered | delivered-partial | `tenant-identity` | — | — | — | — | Machinery live; public DNS verification + canonical cutover unproven locally. |
| `idp-brokering` | delivered | delivered | `platform-login` | `claim-group-mapping`, `real-idp-login-proof` | — | — | — | n/a — OIDC delivered; SAML is a documented gap. |
| `logs` | delivered | delivered | `service-catalog-readiness` | — | — | — | — | n/a — locally proven; prod needs an S3 Loki backend. |
| `mfa-session-policy` | delivered | delivered-partial | `platform-login` | — | — | — | — | MFA/session writable and proven; lockout/recovery surface + MFA-required E2E deferred. |
| `mock-providers` | delivered | mock | — | — | — | — | — | n/a — forbidden in production; must never be a production substrate. |
| `platform-login` | delivered | delivered | — | `user-identity`, `idp-brokering`, `mfa-session-policy` | — | — | — | n/a — locally proven against mock-oidc. |
| `privileged-access-audit` | delivered | delivered | `relational-storage` | `compliance-evidence-access-reviews`, `support-mode-breakglass` | — | — | — | n/a — delivered; retention enforcement is a phase-8 follow-up. |
| `rbac` | delivered | delivered | `user-identity` | `abac-pdp` | — | — | — | n/a — delivered. |
| `relational-storage` | delivered | delivered | — | `backup-restore`, `privileged-access-audit`, `tenant-isolation-proof` | — | — | — | n/a — foundation, locally proven. |
| `secret-setting-writeonly` | delivered | delivered | — | `api-keys-pat`, `runtime-secrets` | — | — | — | Pattern delivered; a Vault/KMS adapter is the phase-8 runtime-secrets follow-up. |
| `service-catalog-readiness` | delivered | delivered | — | `service-catalog-provider-model`, `logs` | — | — | — | n/a — locally proven; the seed for the service-catalog-provider-model. |
| `support-mode-breakglass` | delivered | delivered-partial | `privileged-access-audit` | — | — | — | — | Audited support-session present; approval workflow + host-origin escalation deferred. |
| `tenant-config-registry` | delivered | delivered | `tenant-identity` | `branding-theme` | — | — | — | n/a — delivered; full rollback history is a future enhancement. |
| `tenant-identity` | delivered | delivered | — | `user-identity`, `tenant-config-registry`, `custom-domains-dns-tls` | — | — | — | n/a — foundation, locally proven. |
| `tenant-isolation-proof` | delivered | delivered | `relational-storage` | — | — | — | — | n/a — core isolation proven; shared-tool gaps explicit in clickthrough policy. |
| `user-identity` | delivered | delivered | `tenant-identity`, `platform-login` | `end-user-profile-self-service`, `rbac` | — | — | — | n/a — delivered. |
| `webhooks-developer` | delivered | delivered | — | `event-bus-queues-dlq` | — | — | — | n/a — locally proven; the seed for the event/queue substrate. |
| `build-vs-compose-framework` | phase-0 | planning | `usf-scope-boundary` | — | `environment-service-classification` | — | Y | Build/compose decisions made ad hoc; accidental rewrites of mature capabilities. |
| `environment-service-classification` | phase-0 | planning | `usf-scope-boundary` | `service-catalog-provider-model` | `build-vs-compose-framework` | — | Y | Unsafe shared services composed without an isolation/leakage analysis. |
| `usf-scope-boundary` | phase-0 | planning | — | `build-vs-compose-framework`, `environment-service-classification`, `service-catalog-provider-model` | — | — | Y | Without a scope boundary the foundation drifts into fake readiness and scope creep. |
| `abac-pdp` | phase-1 | planned | `rbac` | `api-keys-pat`, `groups`, `delegated-admin-roles` | `entitlements` | — | — | Delegated admin and scoped API keys cannot be modelled. |
| `entitlements` | phase-1 | planned | `service-catalog-provider-model` | `metering-usage-meters`, `quota-enforcement`, `api-docs-portal-sdk-ratelimits`, `product-catalog-plans-prices` | `abac-pdp`, `search-indexing` | Y | — | Billing, quotas, and paid feature gating all stall; flags cannot become plan-linked entitlements. |
| `service-catalog-provider-model` | phase-1 | planned | `usf-scope-boundary`, `environment-service-classification`, `service-catalog-readiness` | `entitlements`, `metering-usage-meters`, `search-indexing`, `event-bus-queues-dlq`, `metrics-traces`, `data-governance-catalog-lineage-pii-dsr`, `support-tickets-health-comms` | `abac-pdp` | — | Y | Every composed service integrates ad hoc; no consistent provider-adapter catalog. |
| `metering-usage-meters` | phase-2 | planned | `service-catalog-provider-model`, `entitlements` | `quota-enforcement`, `product-catalog-plans-prices` | — | Y | — | Usage billing and quotas have no signal source. |
| `quota-enforcement` | phase-2 | planned | `entitlements`, `metering-usage-meters` | `subscriptions-invoices-payments`, `object-storage` | — | Y | — | No limit enforcement; abuse and cost-overrun risk. |
| `api-docs-portal-sdk-ratelimits` | phase-3 | planned | `api-keys-pat`, `entitlements` | — | — | Y | Y | No self-serve developer experience; rate limits unenforceable; OpenAPI drift stays unguarded. |
| `api-keys-pat` | phase-3 | planned | `abac-pdp`, `secret-setting-writeonly` | `api-docs-portal-sdk-ratelimits` | `search-indexing` | Y | — | No programmatic access; developer portal and rate limits blocked. |
| `search-indexing` | phase-4 | planned | `service-catalog-provider-model` | — | `entitlements`, `abac-pdp` | Y | Y | No product search; the SearchPort scaffold stays unwired. |
| `background-workers-runtime` | phase-5 | planned | `event-bus-queues-dlq` | `workflow-engine-scheduled-jobs` | — | — | — | Single in-memory worker cannot scale or persist heartbeat. |
| `event-bus-queues-dlq` | phase-5 | planned | `service-catalog-provider-model`, `webhooks-developer` | `background-workers-runtime`, `workflow-engine-scheduled-jobs`, `notifications` | `search-indexing` | — | — | No internal eventing backbone; workflow engine and multi-channel notifications blocked. |
| `workflow-engine-scheduled-jobs` | phase-5 | planned | `event-bus-queues-dlq`, `background-workers-runtime` | `import-export`, `data-governance-catalog-lineage-pii-dsr`, `subscriptions-invoices-payments`, `serverless-functions` | — | Y | Y | No durable orchestration, approvals, or scheduled jobs; DSR/import-export/dunning blocked. |
| `delegated-admin-roles` | phase-6 | planned | `abac-pdp`, `groups` | — | — | Y | — | Tenant admins cannot delegate scoped admin rights. |
| `end-user-profile-self-service` | phase-6 | planned | `user-identity` | `notifications` | `groups`, `sub-organisations` | Y | — | No end-user self-service; notification preferences blocked. |
| `groups` | phase-6 | planned | `abac-pdp` | `delegated-admin-roles` | `sub-organisations`, `end-user-profile-self-service` | Y | — | Routes exist but no bulk role-assignment UI. |
| `notifications` | phase-6 | planned | `event-bus-queues-dlq`, `end-user-profile-self-service` | `alerting-incident-oncall`, `support-tickets-health-comms` | — | Y | Y | Only transactional email exists; incident escalation and user preferences blocked. |
| `sub-organisations` | phase-6 | planned | — | — | `groups` | Y | — | Routes exist but no nested-org UI. |
| `alerting-incident-oncall` | phase-7 | planned | `metrics-traces`, `notifications` | — | — | Y | Y | No alert rules, on-call, incident lifecycle, or public status page. |
| `metrics-traces` | phase-7 | planned | `service-catalog-provider-model` | `alerting-incident-oncall` | — | — | Y | OTEL collector ingests but there is no backend; SLOs and alerting blocked. |
| `backup-restore` | phase-8 | planned | `relational-storage` | `pitr-retention-legalhold-residency`, `tenant-lifecycle-suspend-delete-export` | `metrics-traces` | — | — | Local scripts only; no production recovery confidence; tenant lifecycle unsafe. |
| `compliance-evidence-access-reviews` | phase-8 | planned | `privileged-access-audit` | — | — | Y | — | No access reviews or compliance evidence packs. |
| `data-governance-catalog-lineage-pii-dsr` | phase-8 | planned | `service-catalog-provider-model`, `workflow-engine-scheduled-jobs`, `import-export` | `tenant-lifecycle-suspend-delete-export` | `pitr-retention-legalhold-residency` | Y | Y | No DSR/GDPR; tenant deletion unsafe; compliance gap. |
| `import-export` | phase-8 | planned | `workflow-engine-scheduled-jobs` | `data-governance-catalog-lineage-pii-dsr`, `tenant-lifecycle-suspend-delete-export` | — | Y | — | No portability/offboarding; DSR and tenant deletion blocked. |
| `pitr-retention-legalhold-residency` | phase-8 | planned | `backup-restore` | — | `data-governance-catalog-lineage-pii-dsr` | — | Y | No point-in-time recovery, retention, legal hold, or residency controls. |
| `runtime-secrets` | phase-8 | planned | `secret-setting-writeonly` | — | — | — | Y | Secrets remain env/db only; no central rotation or audit; LocalStack secretsmanager is mock-only. |
| `tenant-lifecycle-suspend-delete-export` | phase-8 | planned | `backup-restore`, `data-governance-catalog-lineage-pii-dsr`, `import-export` | — | — | Y | — | No safe suspend/delete; compliance and offboarding risk. |
| `product-catalog-plans-prices` | phase-9 | planned | `entitlements`, `metering-usage-meters` | `subscriptions-invoices-payments` | — | Y | Y | No sellable catalog; monetization blocked. |
| `subscriptions-invoices-payments` | phase-9 | planned | `product-catalog-plans-prices`, `quota-enforcement`, `workflow-engine-scheduled-jobs` | — | — | Y | Y | No monetization. Payment capture is the only production-external paid dependency and cannot be proven locally end-to-end. |
| `object-storage` | phase-10 | planned | `quota-enforcement` | — | — | — | — | Storage stays readiness-only; no file product, quotas, lifecycle, AV scan, or legal hold. |
| `support-tickets-health-comms` | phase-10 | planned | `service-catalog-provider-model`, `notifications` | — | — | Y | Y | No ticketing, customer health, incident comms, or announcements. |
| `serverless-functions` | deferred | deferred | `workflow-engine-scheduled-jobs` | — | — | — | — | None — explicitly deferred until a concrete product need; large security surface. |
| `real-idp-login-proof` | blocked | blocked | `idp-brokering` | — | — | — | — | Enterprise SSO remains unproven against a real external IdP; mock-oidc cannot substitute. |

## How to read a row

- **Phase** — where it sits in the [implementation roadmap](./universal-service-foundation-implementation-roadmap.md). `delivered` rows are already shipped (full or partial) and are off the new roadmap; `deferred` / `blocked` are explicitly not scheduled.
- **Depends on** — hard prerequisites. Do not start this capability until all of these are at least functionally in place.
- **Blocks** — derived; what stays missing or fake until this lands.
- **Parallel with** — safe to build concurrently; no ordering constraint between them.
- **Pre-UI / Pre-compose** — gates described above.
- **Risk if delayed** — the concrete cost of leaving this capability missing.

## Companion documents

- [Implementation roadmap](./universal-service-foundation-implementation-roadmap.md) — the phase-by-phase plan (Workstream E).
- [Provider shortlist](./universal-service-foundation-provider-shortlist.md) — local-first candidate evaluation for each composed capability (Workstream D).
- [Matrix](./universal-service-foundation-matrix.md) and [registry](./universal-service-foundation-registry.json) — per-capability state.
