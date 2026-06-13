# Universal Service Foundation — implementation roadmap

- **Action:** ADR-ACT-0252 (delivery hardening); ADR-ACT-0254 (Phase 1 delivered)
- **Source ADRs:** ADR-0053/0054/0055/0056/0058 **Accepted**; ADR-0057, ADR-0059–0066 Proposed (0057/0059/0062/0063 require splitting)
- **Date:** 2026-06-13
- **Status of this document:** governance / planning artifact. It sequences implementation. **Update (ADR-ACT-0254):** Phase 0 governance is complete and the Phase-0 ADRs are Accepted; the **Phase 1 substrate is delivered** (entitlement engine + service catalog v2 + policy-chain hook, node:test/MSW/in-memory proven — see `phase-1-service-catalog-entitlements.md`). **Phase 2 (metering + real quota enforcement, ADR-ACT-0256)** and **Phase 3 (API keys + rate limits + read-only developer portal foundation, ADR-ACT-0257)**, **Phase 4 (built-in Postgres tenant-isolated search, ADR-ACT-0258)**, and **Phase 5 (Postgres-outbox event bus + durable workers + DLQ/redrive, ADR-ACT-0259)**, **Phase 6 (end-user profile self-service + notification preferences + local notification substrate, ADR-ACT-0260)**, and **Phase 7 (built-in observability/alerting/incident foundation, ADR-ACT-0261)** are now **delivered + live-proven** (see `phase-2-metering-quota.md`, `phase-3-api-keys-rate-limits.md`, `phase-4-search.md`, `phase-5-events-workers.md`, `phase-6-profile-notifications.md`, `phase-7-observability-alerting.md`). Billing, the workflow engine, composed providers (search engine / notification provider / metrics-trace + alerting backends / on-call + status page), and any new composed service remain **not delivered**.

## What this is

A phase-by-phase plan to deliver the missing and partial USF capabilities in a **safe, dependency-correct order**. Phases follow the dependency graph in [`universal-service-foundation-delivery-dependencies.md`](./universal-service-foundation-delivery-dependencies.md); candidates follow [`universal-service-foundation-provider-shortlist.md`](./universal-service-foundation-provider-shortlist.md); per-capability state is in the [matrix](./universal-service-foundation-matrix.md) and [registry](./universal-service-foundation-registry.json) (`delivery.phaseTitles` maps capabilities to these phases).

**Hard rule for every phase:** a capability is delivered only when it has an Accepted ADR, an ACTION-REGISTER row, a hexagonal port + adapter, a BFF contract + route scope, a permission model, tenant + data isolation, audit events, a readiness model, a runnable `proof:*` script, an evidence document, the relevant UI surface, and a production classification — and `npm run usf:validate` stays green. A running container is never a delivered capability.

---

## Phase 0 — Governance hardening (this slice)

**Objective.** Make the plan implementation-ready: a dependency graph, a provider shortlist, a roadmap, a hardened validator, and a per-ADR decision-quality assessment — before any service is built.

**Why now.** ADR-0053–0066 set direction but none is decision-complete or Accepted. Starting implementation against a Proposed, unscored ADR risks rework and fake-readiness.

**What it unlocks.** A safe start signal for Phase 1 and a mechanical guard (validator) against dishonest status.

**Files touched (this slice).** `universal-service-foundation-registry.json` (`delivery` block), the three new evidence docs, `tools/architecture/validate-universal-foundation/src/index.mjs` (+ test), `ACTION-REGISTER.md` (ADR-ACT-0252), this matrix's companion links, `README.md` (honesty section).

**New ADR-ACT rows.** ADR-ACT-0252 (this hardening). **New packages/compose/ports/contracts/UI.** None. **Proof scripts.** `npm run usf:validate`, `npm run test:architecture`.

**Acceptance criteria.** Dependency graph covers all 54 capabilities and is acyclic; all 12 required dependency truths enforced; provider shortlist covers every composed capability with a free-local candidate and license flag; validator detects broken proof/route/UI/dependency references; README does not imply USF is implemented.

**Estimated size.** M. **Risk.** Low. **Stop condition.** `usf:validate` and `test:architecture` green; the ADR hardening assessment (below) recorded.

### ADR decision-quality assessment (Workstream C)

All 14 ADRs share a sound template (Status/Context/Decision/Consequences/Validation) and a clear decision *direction*, but **none carries explicit rejected-alternatives, testable acceptance criteria, implementation phases, named proof requirements, or an explicit production-blocker list**. Therefore **none is auto-accepted**; each stays **Proposed** and is hardened under ADR-ACT-0252 *before the phase that implements it is scheduled*.

| ADR | Topic | Decision-quality? | Key unresolved / missing | Verdict |
| --- | --- | --- | --- | --- |
| 0053 | Scope & principles | **Near-ready** | None material; needs human acceptance review | Keep Proposed → **acceptance review first** |
| 0054 | Build-vs-compose framework | **Near-ready** | Advisory rubric; ready for acceptance review | Keep Proposed → acceptance review |
| 0056 | Environment classification | **Near-ready** | Checklist is concrete; ready for acceptance review | Keep Proposed → acceptance review |
| 0055 | Service catalog / provider model | Partial | No catalog schema or provider-adapter acceptance criteria | Keep Proposed; harden before Phase 1 |
| 0058 | PDP + delegated admin | Partial | Delegated-admin scope model undefined; no acceptance criteria | Keep Proposed; harden before Phase 1/6 |
| 0057 | Entitlement / billing / quota | **Too broad** | Bundles entitlements+metering+quota+billing+payment; needs split + Lago/KillBill/OpenMeter spike outcome + per-sub acceptance criteria | Keep Proposed; **split** before Phase 1/2/9 |
| 0061 | Analytics / metering | Overlaps 0057 | Metering-vs-analytics boundary; OpenMeter PoC criteria | Keep Proposed; harden before Phase 2 |
| 0060 | Search / indexing | Partial | Meili-vs-Typesense spike; index-per-tenant + permission-filter acceptance criteria | Keep Proposed; harden before Phase 4 |
| 0059 | Workflow / event / queue | **Too broad** | Bundles eventing+workflow+scheduler+notifications; needs Windmill-vs-Temporal spike + idempotency/tenant-isolation criteria | Keep Proposed; **split** before Phase 5/6 |
| 0062 | Observability / alerting / incident | **Too broad** | Bundles metrics+traces+alerting+incident+on-call+status; split acceptance criteria per layer | Keep Proposed; **split** before Phase 7 |
| 0063 | Data governance / compliance | **Too broad** | Bundles catalog+lineage+classification+PII+DSR+reviews; needs DSR-first scope + build-vs-OpenMetadata trigger | Keep Proposed; **split** before Phase 8 |
| 0064 | Backup / recovery / retention | Partial | Production restore-drill acceptance criteria; pgBackRest decision | Keep Proposed; harden before Phase 8 |
| 0065 | Developer platform / API mgmt | Partial | API-keys acceptance criteria; OpenAPI-drift-complete gate; portal scope | Keep Proposed; harden before Phase 3 |
| 0066 | Support / break-glass | Partial | **Host-origin escalation policy explicitly unresolved** (stated in ADR); tenant-deletion coordination criteria | Keep Proposed; harden before Phase 8/10 |

**Hardening definition (per ADR).** Add: (1) explicit alternatives considered + rejected with reasons; (2) testable acceptance criteria; (3) implementation phases; (4) named `proof:*` requirements; (5) an explicit production-blocker list. Three ADRs (0057, 0059, 0062, 0063 — the "too broad" set) should additionally be **split** into per-capability decisions or have per-capability acceptance criteria appended.

---

## Phase 1 — Service catalog + entitlement + policy substrate

**Objective.** Generalise the existing service/clickthrough registries into a provider-adapter **service catalog**; build the **entitlement engine**; confirm **Keycloak UMA** as the PDP and add a PDP port seam.

**Why now.** The service catalog gates all later provider composition (`mustPrecedeCompose`); entitlements gate billing, quotas, and paid features. These have no upstream blockers (only delivered capabilities + Phase 0).

**What it unlocks.** Metering, quotas, billing, search, eventing, metrics — every composed capability plugs into the catalog; every paid/restricted feature gates on entitlements.

**Files likely touched.** `apps/platform-api/src/usecases/platform-services.ts`, `service-clickthrough.ts`, `capability-registry.ts`, new `entitlements` usecase + migration, `server/routes.ts`, `packages/contracts-admin`, `authorisation-runtime`.

**New ADR-ACT rows.** Hardening of ADR-0055/0058; new rows for entitlement engine delivery (under ADR-ACT-0241/0242/0239). **New packages.** `@platform/entitlements` (port + Postgres adapter); PDP port in `authorisation-runtime`. **New compose services.** None. **New ports/adapters.** `EntitlementPort` + Postgres adapter; `PolicyDecisionPort` (UMA adapter). **New BFF contracts.** `GET /api/org/entitlements`; service-catalog read. **New UI surfaces.** `/admin/entitlements` (read), catalog view in `/admin/platform`.

**Proof scripts.** `proof:entitlements`, `proof:service-catalog`. **Acceptance criteria.** Feature/quota checks resolve from entitlements (not raw flags); entitlement changes audited + RLS-isolated; catalog enumerates every service with environment + readiness + isolation; UMA PDP decisions proven via `authorize-resource`.

**Estimated size.** L. **Risk.** High (touches authz). **Stop condition.** Entitlement resolution proven; no quota/billing UI yet (Phase 2+).

---

## Phase 2 — Metering + quota enforcement

**Objective.** Compose **OpenMeter** on the existing ClickHouse for tenant-tagged usage metering; build **quota enforcement** (Redis counters + Postgres limits) gated by entitlements.

**Why now.** Metering is the signal source for usage billing and quotas; quotas need entitlements (Phase 1) + metering. Required truths: `quota → entitlements`, `quota → metering`.

**What it unlocks.** Usage-based billing (Phase 9), abuse/cost protection, plan-limit UX.

**Files likely touched.** New `metering` + `quota` usecases, ClickHouse schema, Redis counters, `server/routes.ts`, BFF middleware for quota checks.

**New ADR-ACT rows.** ADR-0057/0061 hardening + delivery rows. **New packages.** `@platform/metering`, `@platform/quota`. **New compose services.** OpenMeter (reuses ClickHouse). **New ports/adapters.** `MeterPort` (OpenMeter adapter), `QuotaPort` (Redis+PG). **New BFF contracts.** `POST /api/org/meter-events`, `GET /api/org/usage`, quota-exceeded error envelope. **New UI.** Usage panel in `/admin/platform` or `/admin/billing` (read).

**Proof scripts.** `proof:metering`, `proof:quota-enforcement`. **Acceptance criteria.** Meter events tenant-partitioned in ClickHouse; quota check denies past-limit at the BFF with a typed error + audit; OpenMeter runs locally free.

**Estimated size.** L. **Risk.** High. **Stop condition.** Metering + enforcement proven; no invoicing yet.

---

## Phase 3 — API keys + developer portal foundation

**Objective.** Build **API keys / PATs** (scoped, hashed, write-only, audited) behind the PDP; entitlement-aware **rate limits**; complete **OpenAPI drift enforcement**; lay the docs/portal foundation.

**Why now.** API keys need the policy model (Phase 1); rate limits need entitlements (Phase 1). Required truths: `api-keys → abac-pdp`, `api-docs-portal → api-keys`.

**What it unlocks.** Programmatic access, the developer portal, rate-limited integrations.

**Files likely touched.** New `api-keys` usecase + migration (reuse `token-crypto` redaction), rate-limit middleware, `docs/api/openapi.json`, `validate-openapi-drift`, `server/routes.ts`.

**New ADR-ACT rows.** ADR-0065 hardening + delivery. **New packages.** `@platform/api-keys`. **New compose services.** None initially (Redocly/Swagger UI static; Backstage/Kong only if proven). **New ports/adapters.** `ApiKeyPort` (PG, hashed). **New BFF contracts.** `/api/org/api-keys*`, rate-limit headers/error. **New UI.** `/admin/api-keys`, self-service key management.

**Proof scripts.** `proof:api-keys`, `proof:rate-limits`; promote `openapi:drift` to complete. **Acceptance criteria.** Keys hashed at rest, shown once, revocable, audited; rate limit derives from entitlement; OpenAPI drift gate complete and green.

**Estimated size.** L. **Risk.** High (credential surface). **Stop condition.** Keys + rate limits proven; full portal/SDK deferred.

> **DELIVERED (2026-06-13, ADR-ACT-0257).** API keys (server-generated, scrypt salt+pepper hash, shown once, tenant-scoped RLS, entitlement-gated via `api_access`, revocable, audited) + durable Postgres fixed-window **rate limits** (entitlement→limit bridge, audited) + a **read-only developer portal foundation** (`/admin/developer`, `GET /api/org/developer`). Live-proven: `proof:api-keys`, `proof:rate-limits`, `proof:api-key-routes`. Deviations from the original sketch: a `RateLimitPort` durable **Postgres** counter (not Redis — Redis is Phase 3.5 behind the port); kept in `apps/platform-api` (no separate `@platform/api-keys` package); `/admin/developer` (not `/admin/api-keys`). **Not delivered:** Redis limiter, external portal/gateway, SDK gen, sandbox mode, and **schema-level** OpenAPI drift (path+method drift remains enforced).

---

## Phase 4 — Search / indexing

**Objective.** Compose **Meilisearch** (default) behind the existing `SearchPort`; index-per-tenant with permission-aware query filters; reindex jobs.

**Why now.** Independent of the billing chain — only needs the service catalog. Runs in **parallel** with Phases 1–3. Required truth: search precedes any product-search UI.

**What it unlocks.** Product search UI; the `search-runtime` scaffold becomes real.

**Files likely touched.** `packages/search-runtime` (real adapter), new search usecase, `server/routes.ts`, reindex worker.

**New ADR-ACT rows.** ADR-0060 hardening + delivery (ADR-ACT-0244). **New packages.** Meilisearch adapter for `search-runtime`. **New compose services.** Meilisearch. **New ports/adapters.** `SearchPort` Meilisearch adapter. **New BFF contracts.** `GET /api/org/search`. **New UI.** `/admin/search` or product search surface.

**Proof scripts.** `proof:search` (index isolation + permission filter). **Acceptance criteria.** Index-per-tenant; cross-tenant query returns nothing; permission filter enforced server-side; Meilisearch runs locally free (MIT).

**Estimated size.** L. **Risk.** Medium. **Stop condition.** Tenant-isolated search proven.

> **DELIVERED (2026-06-13, ADR-ACT-0258).** Built-in **Postgres full-text search** (migration 026 `search_documents`, RLS-isolated, GIN tsvector), `SearchIndexPort` + `SearchQueryPort`, permission-aware queries, secret-field rejection, operator reindex + readiness, `/admin/search` UI. Live-proven: `proof:search`, `proof:search-isolation`, `proof:search-routes`. Deviation from the sketch: **no Meilisearch composed** — the composed engine is Phase 4.5 behind the same ports (a container is not a capability). **Not delivered:** composed engine, index-per-tenant, typo-tolerance/relevance, indexing producers (wired per capability later).

---

## Phase 5 — Event bus + workflow engine

**Objective.** Generalise the proven webhook substrate into an **internal event bus + durable queues** (Redis Streams); scale the **background worker runtime**; compose a **workflow engine** (Windmill default).

**Why now.** Webhooks (delivered) seed the bus; workflow needs the bus + workers. Required truth: `workflow → event-bus`.

**What it unlocks.** Durable orchestration, approvals, scheduled jobs — prerequisite for import/export, DSR, dunning, and incident automation.

**Files likely touched.** `packages/queue-runtime`, `worker-runtime` (real adapters), new eventing usecase, Windmill integration, `server/routes.ts`.

**New ADR-ACT rows.** ADR-0059 split + delivery (ADR-ACT-0243). **New packages.** Redis-Streams `QueuePort` adapter, real `WorkerPort`. **New compose services.** Windmill (AGPL — recorded decision). **New ports/adapters.** `QueuePort`, `WorkerPort`, `WorkflowPort`. **New BFF contracts.** internal-bus (no public route initially); `/api/org/workflows` (read). **New UI.** `/admin/workflows` (visibility).

**Proof scripts.** `proof:event-bus`, `proof:workflow` (tenant-namespace isolation, idempotency, DLQ/redrive). **Acceptance criteria.** Tenant-tagged events isolated; DLQ + redrive proven (extend webhook pattern); workflow namespaces per tenant; Windmill runs locally free.

**Estimated size.** XL. **Risk.** High. **Stop condition.** Eventing + one durable workflow proven; serverless stays deferred.

> **DELIVERED (event substrate) (2026-06-13, ADR-ACT-0259).** Built-in **Postgres outbox** event bus (migration 027, RLS, idempotent), durable **worker runtime** (claim via FOR UPDATE SKIP LOCKED, retry → **DLQ**, heartbeats), operator **redrive**, `/admin/events` UI. Live-proven: `proof:event-bus`, `proof:event-worker`, `proof:event-redrive`. Deviation from the sketch: **Postgres outbox, not Redis Streams** (Redis is Phase 5.5 behind `EventBusPort`); **no Windmill composed**. **Not delivered:** composed bus, **workflow engine + scheduled jobs** (Phase 5.5+, gated on this substrate), retry backoff schedule. Notifications split to ADR-0068 (Phase 6).

---

## Phase 6 — Notifications + profile self-service + delegated admin

**Objective.** Build **end-user profile/preferences self-service**; build **multi-channel notifications** (email/webhook first, Novu later) with per-user preferences; deliver **groups**, **sub-organisations**, and **delegated-admin** UIs.

**Why now.** Notifications need the event bus (Phase 5) + profile self-service (preferences live on the profile). Groups/sub-orgs/delegated-admin need the policy model (Phase 1). Required truths: `notifications → profile`, `notifications → event-bus`, `delegated-admin → abac+groups`.

**What it unlocks.** User-facing notifications + preferences; incident escalation channels (Phase 7); delegated administration.

**Files likely touched.** `packages/profile-configuration` + `notification-runtime` (real adapters), `AdminLayout.tsx`, new admin routes (`/admin/groups`, `/admin/profile`), `server/routes.ts` (`/api/me/profile`).

**New ADR-ACT rows.** ADR-0058/0059 hardening + delivery (ADR-ACT-0249/0242). **New packages.** real `NotificationPort` + `ProfileConfigPort` adapters. **New compose services.** None initially (Novu only if multi-channel proven). **New BFF contracts.** `/api/me/profile`, `/api/me/notification-preferences`, group/sub-org/delegation routes (mostly exist). **New UI.** `/admin/groups`, `/admin/profile`, delegated-admin surface, notification centre.

**Proof scripts.** `proof:profile`, `proof:notifications`, `proof:delegated-admin`. **Acceptance criteria.** Profile + preferences persisted with RLS + audit; notification respects preferences across channels; delegated grants audited and scope-limited.

**Estimated size.** L. **Risk.** Medium. **Stop condition.** Profile + at least two channels + delegated-admin proven.

> **DELIVERED (profile + notifications) (2026-06-13, ADR-ACT-0260, ADR-0068).** End-user **profile self-service** (migration 028 `user_profiles`, RLS, **own-profile-only**, audited), per-user **notification preferences** (`notification_preferences`, RLS), and a **preference-gated notification substrate** (`notification_log`, RLS; disabled channel suppresses; local channels; secret-payload rejection; operator readiness + test send), `/admin/account` UI. Live-proven: `proof:profile-self-service`, `proof:notification-preferences`, `proof:notification-dispatch`. Deviation from the sketch: `/admin/account` (not `/admin/profile`+`/admin/groups`); **groups/sub-org/delegated-admin UIs are NOT in this slice**. **Not delivered:** composed provider (Novu) + real delivery transports (Mailpit/Brevo SMTP, webhook POST) — Phase 6.5 behind `NotificationDispatchPort`; in-app inbox; delegated-admin UI.

---

## Phase 7 — Observability metrics/traces + alerting/incident

**Objective.** Compose **Prometheus + Tempo** behind the OTEL collector; **Alertmanager** alert rules + SLOs; build incident lifecycle + on-call + a **public status page** on the existing readiness API.

**Why now.** Alerting needs metrics (Phase 7) + notifications (Phase 6). Required truths: `alerting → metrics`, `alerting → notifications`.

**What it unlocks.** SLOs, alerting, incident management, public status — production-operability.

**Files likely touched.** `compose.yaml` (observability profile), OTEL collector config, new incident usecase, status-page surface, `server/routes.ts`.

**New ADR-ACT rows.** ADR-0062 split + delivery (ADR-ACT-0246). **New packages.** incident usecase. **New compose services.** Prometheus, Tempo (AGPL — recorded), Alertmanager. **New ports/adapters.** metrics/trace backends behind collector seam. **New BFF contracts.** `/api/org/incidents`, public status route. **New UI.** incident UI in `/admin/observability`, public status page.

**Proof scripts.** `proof:metrics-traces`, `proof:alerting`, `proof:incident`. **Acceptance criteria.** Metrics/traces queryable with env/tenant labels; an alert fires to a notification channel; incident lifecycle audited; status page reflects real readiness.

**Estimated size.** L. **Risk.** High. **Stop condition.** One alert→incident→status flow proven end-to-end locally.

> **DELIVERED (built-in foundation) (2026-06-13, ADR-ACT-0261, ADR-0062 Accepted).** Built-in **metric-signal registry + samples**, **threshold alert rules + evaluation**, **incident lifecycle** (audited), and an **alert→notification bridge** over the Phase-6 substrate (preference-gated), `/admin/monitoring` UI. Live-proven: `proof:observability-signals`, `proof:alerting`, `proof:incident-foundation`, `proof:alert-notification-bridge`. Deviation from the sketch: **no Prometheus/Tempo/Alertmanager composed** (those + on-call + public status page are Phase 7.5 behind `MetricRepository`/`AlertRepository`); `/admin/monitoring` (the existing `/admin/observability` is tenant log readiness). Registry: `observability-alerting-builtin` → locally proven; `metrics-traces` + `alerting-incident-oncall` remain partial. **Not delivered:** composed metrics/trace + alerting backends, on-call/escalation, public status page, OTEL sample producers.

---

## Phase 8 — Backup/recovery + governance + tenant lifecycle

**Objective.** Promote backups to scheduled/offsite + **pgBackRest PITR**; build **retention/legal-hold/residency**; build **import/export**; build **data governance (DSR-first)**; build **tenant suspend/delete/export**; build **access reviews + compliance evidence packs**.

**Why now.** Tenant deletion is unsafe without backup + governance + import/export. Required truths: `tenant-lifecycle → backup`, `tenant-lifecycle → data-governance`, `tenant-lifecycle → import-export`. Governance/DSR need the workflow engine (Phase 5).

**What it unlocks.** Compliant offboarding, GDPR/DSR, production recovery confidence.

**Files likely touched.** `Makefile` backup scripts, pgBackRest config, new governance/lifecycle usecases + migrations, MinIO export sink, `server/routes.ts`.

**New ADR-ACT rows.** ADR-0063/0064 split + delivery (ADR-ACT-0247/0248/0251). **New packages.** `@platform/data-governance`, lifecycle usecase. **New compose services.** pgBackRest sidecar; OpenMetadata only if metadata volume justifies. **New BFF contracts.** `/api/org/data-export`, `/api/org/dsr`, `/api/admin/tenants/:id/(suspend|delete)`. **New UI.** DSR intake, export, tenant-lifecycle admin.

**Proof scripts.** `proof:pitr`, `proof:dsr`, `proof:import-export`, `proof:tenant-delete` (purges schema + storage + realm). **Acceptance criteria.** Production restore drill documented; tenant delete coordinates DB + storage + realm + DSR; legal hold suspends deletion; all audited.

**Estimated size.** XL. **Risk.** High. **Stop condition.** Recoverable backup + safe tenant deletion proven locally.

---

## Phase 9 — Billing / invoicing / payment provider adapter

**Objective.** Compose **Lago** (or Kill Bill) for plans/prices/subscriptions/invoices/dunning; isolate **payment capture** behind a production-external adapter with a local mock.

**Why now.** Needs catalog + entitlements + metering + quotas + workflow (dunning). Required truths: `product-catalog → entitlements + metering`; subscriptions → catalog + quota + workflow.

**What it unlocks.** Monetization.

**Files likely touched.** billing usecases, Lago integration, payment-provider port + mock, `server/routes.ts`, billing portal UI.

**New ADR-ACT rows.** ADR-0057 split + delivery (ADR-ACT-0241). **New packages.** `@platform/billing`, `PaymentProviderPort`. **New compose services.** Lago (AGPL — recorded) / Kill Bill. **New BFF contracts.** `/api/org/billing/*`. **New UI.** `/admin/billing`, self-service billing portal.

**Proof scripts.** `proof:billing` (subscription lifecycle on local engine), mock-payment proof. **Acceptance criteria.** Plan→subscription→invoice proven locally free; payment capture isolated behind the port; **documented gap: real payment capture is not locally provable end-to-end** (the single sanctioned paid dependency).

**Estimated size.** XL. **Risk.** High. **Stop condition.** Billing lifecycle proven against the OSS engine + mock gateway; real-gateway proof explicitly deferred to a real account.

---

## Phase 10 — Production-ready product UI surfaces

**Objective.** Build the product UI for capabilities whose substrate now exists: the **object-storage product** (file browser, quotas, lifecycle, AV scan, legal hold), the **support desk** (built-in notes → Chatwoot later), rich branding, and the consolidated self-service surfaces.

**Why now.** Each UI here was gated (`mustPrecedeUi`) on a substrate delivered in Phases 1–9 (e.g. object-storage product needs quotas from Phase 2).

**What it unlocks.** End-user-facing product completeness on a proven foundation.

**Files likely touched.** `apps/react-enterprise-app/src/routes/*`, storage/support usecases, `server/routes.ts`.

**New ADR-ACT rows.** ADR-0049/0066 hardening + delivery (ADR-ACT-0223/0251). **New compose services.** Chatwoot only if proven. **New BFF contracts.** storage CRUD, support routes. **New UI.** storage browser, support desk, announcements.

**Proof scripts.** `proof:storage-product`, `proof:support`. **Acceptance criteria.** File CRUD with per-tenant quota + signed access + AV; support tickets tenant-tagged + access-scoped; every surface has MSW coverage + a11y.

**Estimated size.** L–XL. **Risk.** Medium. **Stop condition.** Product UIs proven on their substrates; nothing claimed without a backing proof.

---

## Honest ordering caveats

- **Search (Phase 4), policy (Phase 1), metrics/traces (Phase 7 backend), and backup (Phase 8)** can all start earlier in parallel — they are not on the billing critical path. The phase numbers are a *default sequence*, not a forced serialisation; the dependency graph is the real constraint.
- **Phase 9 (billing) is intentionally late** despite business pull: it has the deepest prerequisite chain (catalog → entitlements → metering → quota → workflow). Pulling it forward would mean faking its dependencies.
- **Phase 7 alerting** could be argued before Phase 6 notifications, but alerting escalation *needs* a notification channel — so notifications come first.
- **`serverless-functions` and `real-idp-login-proof`** are deliberately **off the roadmap** (deferred / blocked) and must not be pulled in without a new ADR / a real external IdP.

## Status of the roadmap (ADR-ACT-0254)

- **Phase 0 — complete.** ADR-0053/0054/0055/0056/0058 hardened and **Accepted**; ADR-0057/0059/0062/0063 kept Proposed pending split.
- **Phase 1 — delivered (substrate).** Service catalog v2 + entitlement engine + policy-chain hook (deny-by-default, audit-before-change, no-self-grant, quota HOOK only), node:test/MSW/in-memory proven. Live-Postgres end-to-end proof + real quota enforcement are follow-ups. See `phase-1-service-catalog-entitlements.md`.
- **Phase 2 — delivered (ADR-ACT-0256).** Built-in Postgres metering + **real quota enforcement** (replacing the Phase-1 hook), live-proven. ADR-0057 split (billing→0057 Phase 9); ADR-0067 + ADR-0061 Accepted. ClickHouse/OpenMeter metering provider is **Phase 2.5** (behind the `MeteringRepository` port). See `phase-2-metering-quota.md`.
- **Phase 3 — next.** API keys / PATs + rate limits, building on the entitlement + quota substrate (rate limits reuse the quota/metering model). Harden ADR-0065 first.
- Everything later remains gated on its prerequisites per the dependency graph. Billing/payment (Phase 9) is **not** delivered. The USF is **not** complete.
