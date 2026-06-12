# Build-versus-compose decision framework

> Governing decision: **ADR-0054** (Proposed). Applied per capability in [`universal-service-foundation-registry.json`](../evidence/platform/universal-service-foundation-registry.json) (`decision` field).

## Purpose

A repeatable rubric for deciding, per capability, whether to **build**, **compose**, **adapter**, **defer**, or **reject**. The goal is consistent decisions, minimal operational sprawl, no paid local dependencies, and no accidental rewrites of mature capabilities.

## The five decisions

- **build** — implement in this repo behind a hexagonal port. Choose for thin, security-sensitive, or already-partial capabilities (entitlements, quotas, API keys, DSR workflows, tenant lifecycle).
- **compose** — run a free local/open-source service. Choose for mature commodity engines with a strong OSS option and a clean tenant-isolation story (search, workflow, metering, metrics/trace backends, support desk, data catalog).
- **adapter** — integrate a provider behind a port, with a local/OSS or mock equivalent for proof and a production provider for deployment (payment gateway, cloud KMS, real external IdP, Cloudflare TLS).
- **defer** — no concrete product need is proven yet; record the trigger that would change the decision.
- **reject** — out of foundation scope; record why.

## Scoring dimensions

Score each candidate against these dimensions before deciding:

| Dimension                    | Question                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-first feasibility      | Can it be run, tested, and proven locally for free? If no, it cannot be `build`/`compose`; it must be `adapter` with a local mock, or `defer`.           |
| License                      | Is the OSS license acceptable (no GPL/AGPL/SSPL/Commons-Clause conflict per `license:policy`)?                                                           |
| Compose / operational burden | How many containers, how much memory, how much maintenance? Favour light OSS (Meilisearch, Windmill) over heavy (OpenSearch, Temporal) unless justified. |
| Tenant-isolation fit         | Can it isolate per tenant (index-per-tenant, schema-per-tenant, tagged events) or per environment?                                                       |
| Existing repo capability     | Is there already a port/adapter/partial implementation to extend instead of rewrite?                                                                     |
| Production-adapter path      | Is there a clear production provider behind the same port?                                                                                               |
| Security surface             | Does it introduce a high-value secret or privileged surface needing extra review?                                                                        |

## Default biases

1. If the repo already has a proven substrate, **build** by extending it (e.g. internal eventing on the webhook substrate).
2. For commodity engines, **compose** the lightest OSS option that satisfies tenant isolation.
3. When a paid provider is unavoidable, **adapter** with a local mock/OSS equivalent so local proof remains possible.
4. When in doubt and no product need is proven, **defer** — never compose speculatively.

## Worked examples (from the matrix)

- **Search** → compose (Meilisearch/Typesense): commodity engine, light OSS, index-per-tenant isolation, existing `SearchPort`.
- **Entitlements / quotas** → build: thin, security-sensitive, gates other capabilities, no engine needed.
- **Metering** → compose (OpenMeter): reuses already-composed ClickHouse; strong local-first fit.
- **Payment capture** → adapter (production-external): no free local proof possible; isolated behind a port; the only sanctioned paid dependency.
- **Secrets management** → compose (Vault OSS) / build (KMS abstraction): LocalStack secretsmanager is mock-only and must not be the production substrate.
- **Serverless function hosting** → defer: large security surface, no proven product need.

## Output

The decision and its rationale are recorded in the matrix registry (`decision`, `localFreeCandidate`, `notes`) and, for substantial capabilities, in the per-capability ADR (ADR-0057..0066).
