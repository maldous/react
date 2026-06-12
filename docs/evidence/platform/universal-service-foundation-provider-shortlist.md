# Universal Service Foundation — provider shortlist

- **Action:** ADR-ACT-0252 (delivery hardening)
- **Source ADRs:** ADR-0054 (build-vs-compose), ADR-0055 (catalog/provider), ADR-0057/0059/0060/0061/0062/0063/0064/0065/0066.
- **Date:** 2026-06-13
- **Status of this document:** planning artifact. A "Recommended" row is a **default for a provider-selection spike**, not a decision to compose anything now. No service is added in this pass.

## How to read this

Every composed capability must have a **free local-first path** (ADR-0053 principle 2). This document evaluates the candidates per capability so the eventual provider-selection spike starts from an honest comparison rather than a vibe.

### License posture (read first)

The repo's `license:policy` flags **GPL / AGPL / SSPL / Commons-Clause**. Two practical clarifications drive the recommendations below:

- **AGPL-3.0** is the most common license for the mature OSS ops tools here. The repo **already runs Grafana and Loki, which are AGPL-3.0**, as internal per-environment services. AGPL's network-copyleft obligation bites when you *distribute or expose the tool's own modified source/UI* to third parties; running an unmodified server internally and reaching it over a port is the established posture in this repo. AGPL candidates are therefore **acceptable for internal ops tooling** but a **deliberate human decision** for anything tenant-facing or embedded. Each AGPL row is flagged.
- **BUSL-1.1 (HashiCorp Vault, since 2023)** is *not* OSI-open and is a real adoption risk. Where it appears the recommendation is the **OpenBao** fork (MPL-2.0) or a built-in KMS abstraction.
- **SSPL / Commons-Clause** candidates are flagged as **avoid** unless a human license review clears them.

Columns: **License** · **Compose complexity** (containers/config) · **Runtime burden** (memory/CPU) · **Tenant isolation fit** · **Production adapter path** · **Security surface** · **Recommended (for the spike)** · **Why / why not**.

---

## Search (`search-indexing`, ADR-0060)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Meilisearch** | MIT | 1 container, trivial | Low (~100–300 MB) | Good — index-per-tenant; simple key scoping | Meilisearch Cloud or self-host behind `SearchPort` | Low (HTTP + API key) | **Yes (default)** | Lightest path, clean index-per-tenant isolation, MIT, matches the existing `SearchPort` scaffold. |
| Typesense | **GPL-3.0** ⚠️ | 1 container, trivial | Low | Good — collection-per-tenant | Typesense Cloud / self-host | Low | Maybe | Technically excellent and light, but **GPL-3.0** — flag for license review even though it runs as a standalone server. |
| OpenSearch | Apache-2.0 | Heavy (JVM, ≥1–2 GB; cluster for prod) | High | Good — index-per-tenant + doc-level security | AWS OpenSearch Service / self-host | Medium (JVM, plugins) | No (overkill) | Reserve for heavy analytical/relevance search only; operational burden unjustified for product search now. |

---

## Workflow (`workflow-engine-scheduled-jobs`, ADR-0059)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Windmill** | **AGPL-3.0** ⚠️ | Moderate (app + worker + Postgres) | Moderate | Good — workspace/namespace per tenant | Windmill Cloud / self-host | Medium (executes code) | **Yes (default), license decision required** | Lightest durable-workflow path, reuses Postgres; **AGPL-3.0** — acceptable as internal ops tooling (cf. Grafana/Loki) but record the decision. |
| Temporal | MIT | Heavy (server + matching/history/frontend + DB + UI) | High | Good — namespace per tenant | Temporal Cloud / self-host | Medium | Maybe (if durability demands) | MIT and best-in-class for long-running durable guarantees, but heavy to operate; choose only if Windmill's model proves insufficient. |
| Camunda 8 / Zeebe | **Camunda source-available** ⚠️ (Zeebe not OSI; Camunda 7 is Apache-2.0) | Heavy | High | Per-tenant via process scoping | Camunda SaaS | Medium | No | BPMN-heavy; licensing of Camunda 8/Zeebe is source-available, not OSI-open — fails the free-local-first test cleanly. |

---

## Metering / billing (`metering-usage-meters`, `product-catalog-plans-prices`, `subscriptions-invoices-payments`, ADR-0057/0061)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **OpenMeter** (metering) | Apache-2.0 | Moderate (reuses **existing ClickHouse**) | Low–moderate | Good — tenant-tagged meter events; CH partition by tenant | OpenMeter Cloud / self-host | Low–medium | **Yes (metering)** | Apache-2.0 and reuses the per-environment ClickHouse already composed — strongest local-first fit for metering. |
| Lago (billing) | **AGPL-3.0** ⚠️ | Moderate (api + worker + Postgres + Redis) | Moderate | Per-tenant subscriptions | Lago Cloud / self-host | Medium (financial data) | **Yes (billing), license decision required** | Most complete OSS billing engine; **AGPL-3.0** — flag for review; financial data raises the security surface. |
| Kill Bill (billing) | Apache-2.0 | Heavy (JVM + plugins + DB) | High | Per-tenant accounts | Self-host | Medium | Maybe | Apache-2.0 (no copyleft concern) and very mature, but JVM-heavy; pick over Lago if AGPL is unacceptable. |
| Custom ledger | n/a (build) | n/a | n/a | Native RLS | n/a | Medium | Fallback | Only if both engines are rejected; high build cost, re-implements a solved problem. |

> **Payment capture** stays a **production-external adapter** (Stripe/Adyen/etc.) behind a payment-provider port. It is the single sanctioned paid dependency and is **never required for local proof** — local proof uses a mock gateway.

---

## Policy / PDP (`abac-pdp`, `delegated-admin-roles`, ADR-0058)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Keycloak UMA (current)** | Apache-2.0 | None new (already composed) | None new | Per-realm resource/scope policy | Same | Low (in place) | **Yes (keep)** | Already the real PEP/PDP via `authorisation-runtime`; no new service, no new license. Default per ADR-0058. |
| OPA (Open Policy Agent) | Apache-2.0 | 1 sidecar | Low | Policy bundles per tenant | Self-host / OPA Cloud | Low–medium | Only if needed | Add behind a PDP port **only** if a concrete attribute-policy need is proven that UMA cannot express. |
| Cedar (local adapter) | Apache-2.0 | Library (no container) | Low | Policy store per tenant | Self-host | Low | Only if needed | Apache-2.0 embeddable engine; alternative to OPA if a code-level policy model is preferred. |

---

## Notifications (`notifications`, ADR-0059)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Built-in email/webhook first** | n/a (build) | None new (Mailpit + webhook substrate exist) | Low | Tenant+user scoped | SMTP/Brevo + webhook | Low | **Yes (start here)** | Email channel is already proven (`proof:email-sender`); the webhook substrate is delivered. Build a notification port + preferences on top before composing anything. |
| Novu | MIT (core) | Moderate (api + worker + Postgres + Redis + MongoDB) | Moderate–high | Subscriber per tenant/user | Novu Cloud / self-host | Medium | Maybe (in-app/push) | MIT core, good for in-app/push fan-out; the MongoDB dependency raises compose burden — add only when multi-channel is real. |
| ntfy | Apache-2.0 / GPL-2.0 | 1 container, trivial | Very low | Topic per tenant | Self-host | Low | Maybe (push only) | Tiny push/pub-sub; useful for simple push but not a full preference/channel engine. |

---

## Secrets (`runtime-secrets`, ADR-0055/0031)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **OpenBao** (Vault fork) | MPL-2.0 | Moderate | Moderate | Path-scoped per tenant | OpenBao / cloud KMS | **High** (secret store) | **Yes (default)** | MPL-2.0 fork of Vault — avoids Vault's **BUSL-1.1** adoption risk while keeping the API/feature set. |
| HashiCorp Vault OSS | **BUSL-1.1** ⚠️ | Moderate | Moderate | Path-scoped | Vault / HCP | High | No (license) | Functionally the reference, but **BUSL-1.1 is not OSI-open** — prefer OpenBao. |
| Built-in KMS abstraction | n/a (build) | None new | Low | Per-tenant key derivation | Cloud KMS adapter | High | Fallback | Extends the proven `token-crypto` write-only pattern; lower feature ceiling than a real secrets manager. |
| LocalStack Secrets Manager | n/a (mock) | (cloud-mocks profile) | Low | n/a | **none — mock only** | n/a | **No** | Explicitly **mock-only / forbidden-in-production**; must never be the secrets substrate. |

---

## Observability — metrics/traces + alerting (`metrics-traces`, `alerting-incident-oncall`, ADR-0062)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Prometheus** (metrics) | Apache-2.0 | 1 container behind existing OTEL collector | Moderate | env/tenant labels | Self-host / Grafana Cloud | Low | **Yes** | Apache-2.0, the de-facto metrics backend; slots behind the OTEL collector seam already present. |
| **Tempo** (traces) | **AGPL-3.0** ⚠️ | 1 container | Moderate | env/tenant labels | Self-host / Grafana Cloud | Low | **Yes (license decision)** | Best fit alongside the existing Grafana/Loki/Alloy stack; **AGPL-3.0** — same posture as the already-composed Grafana/Loki. |
| **Alertmanager** (alerting) | Apache-2.0 | 1 container | Low | route by label | Self-host | Low | **Yes** | Apache-2.0; pairs with Prometheus for alert routing/silencing. |
| Grafana Alerting (alerting) | **AGPL-3.0** ⚠️ | None new (Grafana composed) | None new | env labels | Self-host | Low | Maybe | Reuses composed Grafana; AGPL already accepted here. Choose Alertmanager vs Grafana Alerting in the spike. |

> **Status page** and **incident lifecycle/on-call** are **build** on the existing readiness API + notification substrate — no new vendor needed for the first slice.

---

## Support desk (`support-tickets-health-comms`, ADR-0066)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Built-in support notes first** | n/a (build) | None new | Low | Tenant-scoped via RLS | n/a | Low | **Yes (start here)** | Audit + readiness + notifications already exist; build tenant-tagged support notes/announcements before composing a desk. |
| Chatwoot | MIT (core; enterprise edition separate) | Moderate (rails + Postgres + Redis) | Moderate | Per-account inbox; tenant tagging required | Chatwoot Cloud / self-host | Medium | Maybe | MIT core; verify the enterprise-edition split at adoption time. |
| Zammad | **AGPL-3.0** ⚠️ | Heavy (rails + Postgres + Elasticsearch + Redis) | High | Per-group; tenant tagging required | Self-host | Medium | Maybe | Feature-rich but **AGPL-3.0** + Elasticsearch dependency makes it the heaviest option; shared-service isolation checklist (ADR-0056) is mandatory. |

---

## Data governance (`data-governance-catalog-lineage-pii-dsr`, ADR-0063)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **Built-in data registry first** | n/a (build) | None new | Low | Metadata + per-tenant DSR | n/a | Medium | **Yes (start here)** | DSR/export/retention are **build** on the workflow + storage substrate; a heavyweight catalog is not needed for the first compliance slice. |
| OpenMetadata | Apache-2.0 | Heavy (app + MySQL/Postgres + Elasticsearch + Airflow) | High | Metadata-only, env/tenant tagged | Self-host | Medium | Maybe (later) | Apache-2.0; catalog/lineage if/when metadata volume justifies it; **shared-cross-environment metadata only** per ADR-0056. |
| DataHub | Apache-2.0 | Heavy (GMS + Kafka + Elasticsearch + DB) | High | Metadata-only | Self-host / Acryl | Medium | Maybe (later) | Apache-2.0; heaviest footprint (Kafka + ES); only at real scale. |

---

## Backup / PITR (`backup-restore`, `pitr-retention-legalhold-residency`, ADR-0064)

| Candidate | License | Compose | Runtime | Tenant isolation fit | Prod adapter | Security surface | Recommended | Why / why not |
| --- | --- | --- | --- | --- | --- | --- | :-: | --- |
| **pgBackRest** (PITR) | MIT | Light (sidecar/cron + repo) | Low | Same boundary as Postgres | Self-host + S3/MinIO repo | Medium | **Yes** | MIT; mature Postgres WAL-archiving/PITR; writes to per-environment MinIO/S3 — clean local-first path. |
| pg_dump scripts (current) | n/a (build) | None new (scripts exist) | Low | Full-DB | n/a | Medium | Keep (baseline) | `proof:backup-local` already proven; promote to scheduled/offsite, then add pgBackRest for PITR. |

---

## Summary recommendations (for the spike, not a decision)

| Capability | Default candidate | License flag |
| --- | --- | --- |
| Search | **Meilisearch** | none (MIT) |
| Workflow | **Windmill** | AGPL-3.0 — decision required |
| Metering | **OpenMeter** | none (Apache-2.0) |
| Billing | **Lago** (or Kill Bill if AGPL rejected) | Lago AGPL-3.0 — decision required |
| Policy | **Keycloak UMA (keep)** | none (Apache-2.0) |
| Notifications | **built-in email/webhook → Novu later** | Novu MIT |
| Secrets | **OpenBao** | avoids Vault BUSL-1.1 |
| Metrics/traces | **Prometheus + Tempo** | Tempo AGPL-3.0 — same as composed Grafana/Loki |
| Alerting | **Alertmanager** | none (Apache-2.0) |
| Support | **built-in notes → Chatwoot later** | Chatwoot MIT core |
| Data governance | **built-in registry → OpenMetadata later** | none (Apache-2.0) |
| Backup/PITR | **pgBackRest** | none (MIT) |

**Pattern:** build the thin/security-sensitive capabilities, reuse what is already composed (ClickHouse for metering, Grafana stack for observability, Keycloak for policy, the webhook substrate for eventing), and only compose a heavy new engine when a built-in path is genuinely insufficient. Every AGPL/BUSL choice is a recorded human decision, not a default slipped in.
