# Adversarial USF Assurance Attestation

Status: FAIL

This attestation is generated from runtime-derived inventories under `docs/v2-foundation/usf-audit/`.
Overall PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, orphan, and formal proof-readiness checks all have zero gaps.
The adversarial runtime inventory status is reported separately from formal proof readiness so runtime inventory closure cannot be mistaken for full migration proof.

| Measure                                     | Count |
| ------------------------------------------- | ----: |
| adversarial runtime status                  |  PASS |
| formal proof readiness status               |  FAIL |
| formal proof readiness gaps                 |    48 |
| capability proof readiness gaps             |    48 |
| full-service/provider-verified capabilities |    41 |
| fully proven capabilities                   |     0 |
| routes discovered                           |   235 |
| routes without tracing                      |     0 |
| routes without logging                      |     0 |
| routes without metrics                      |     0 |
| mutations without audit                     |     0 |
| capabilities without ownership              |     0 |
| semantic orphans                            |     0 |
| runtime orphans                             |     0 |
| provider reliability gaps                   |     0 |
| workflow proof gaps                         |     0 |
| storage proof gaps                          |     0 |
| event runtime gaps                          |     0 |
| false-positive items                        |     0 |
| external-limited items                      |     0 |
| duplicate findings                          |     0 |
| obsolete-runtime-artifact items             |     0 |
| must-fix-in-v1 items                        |     0 |

## Runtime Audit Gaps Identified

- none

## Formal Proof Readiness Gaps Identified

- capability-real-provider-proof-missing: User identity + tenant membership - User identity + tenant membership is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Tenant groups - Tenant groups is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Sub-organisations - Sub-organisations is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: RBAC (roles + permissions) - RBAC (roles + permissions) is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: ABAC / Policy Decision Point - ABAC / Policy Decision Point is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: ABAC / Policy Decision Point - ABAC / Policy Decision Point is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Support-mode / break-glass access - Support-mode / break-glass access is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Audit of privileged access - Audit of privileged access is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Platform login + session - Platform login + session is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: IdP brokering + OIDC provider management - IdP brokering + OIDC provider management is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Claim mapping + group/role mapping - Claim mapping + group/role mapping is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Claim mapping + group/role mapping - Claim mapping + group/role mapping is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: MFA + session policy + lockout - MFA + session policy + lockout is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Configuration registry + history - Configuration registry + history is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Branding + theming - Branding + theming is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Custom domains, DNS ownership, TLS, canonical - Custom domains, DNS ownership, TLS, canonical is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Write-only secret settings - Write-only secret settings is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Write-only secret settings - Write-only secret settings is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Product catalog, plans, prices - Product catalog, plans, prices is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Subscriptions, invoices, payment methods, dunning - Subscriptions, invoices, payment methods, dunning is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Subscriptions, invoices, payment methods, dunning - Subscriptions, invoices, payment methods, dunning is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Relational storage + migrations + RLS - Relational storage + migrations + RLS is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Data governance: catalog, lineage, classification, PII, DSR/GDPR - Data governance: catalog, lineage, classification, PII, DSR/GDPR is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Object storage + tenant prefixes + signed URLs - Object storage + tenant prefixes + signed URLs is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Workflow engine, scheduled jobs, approvals - Workflow engine, scheduled jobs, approvals is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Workflow engine, scheduled jobs, approvals - Workflow engine, scheduled jobs, approvals is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Notification delivery + preferences + channels - Notification delivery + preferences + channels is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Runtime secrets management - Runtime secrets management is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Logs (aggregation + tenant-scoped search) - Logs (aggregation + tenant-scoped search) is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Metrics + traces - Metrics + traces is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Observability — built-in alerting + incidents - Observability — built-in alerting + incidents is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Internal service catalog + readiness - Internal service catalog + readiness is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Code quality + secret + dependency scanning - Code quality + secret + dependency scanning is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Code quality + secret + dependency scanning - Code quality + secret + dependency scanning is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Webhooks (developer-facing) - Webhooks (developer-facing) is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: API docs, developer portal, SDKs, rate limits - API docs, developer portal, SDKs, rate limits is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: API docs, developer portal, SDKs, rate limits - API docs, developer portal, SDKs, rate limits is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Rate limiting (API) - Rate limiting (API) is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Tenant lifecycle: provision, suspend, delete, export - Tenant lifecycle: provision, suspend, delete, export is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Support tickets, customer health, announcements - Support tickets, customer health, announcements is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Service catalog + provider integration model - Service catalog + provider integration model is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: OIDC discovery / issuer / JWKS validation - OIDC discovery / issuer / JWKS validation is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: OIDC test connection + callback display - OIDC test connection + callback display is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Tenant domain activation (auth-client) - Tenant domain activation (auth-client) is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Tenant canonical domain set/unset - Tenant canonical domain set/unset is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-external-sandbox-proof-missing: Tenant custom-domain auth callback - Tenant custom-domain auth callback is PROVIDER_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Browser telemetry (Grafana Faro RUM + browser-to-BFF tracing) - Browser telemetry (Grafana Faro RUM + browser-to-BFF tracing) is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Browser telemetry (Grafana Faro RUM + browser-to-BFF tracing) - Browser telemetry (Grafana Faro RUM + browser-to-BFF tracing) is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
