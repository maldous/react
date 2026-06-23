# Adversarial USF Assurance Attestation

Status: FAIL

This attestation is generated from runtime-derived inventories under `docs/v2-foundation/usf-audit/`.
Overall PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, orphan, and formal proof-readiness checks all have zero gaps.
The adversarial runtime inventory status is reported separately from formal proof readiness so runtime inventory closure cannot be mistaken for full migration proof.

| Measure                                     | Count |
| ------------------------------------------- | ----: |
| adversarial runtime status                  |  PASS |
| formal proof readiness status               |  FAIL |
| formal proof readiness gaps                 |   309 |
| capability proof readiness gaps             |    89 |
| full-service/provider-verified capabilities |     0 |
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

- proof-command-failed: apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/auth-settings-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/backup-local-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/billing-catalog-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/credential-lifecycle-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/dashboards-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/data-governance-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/email-sender-runtime-proof.ts - proof command exited 2
- observability-proof-signal: apps/platform-api/scripts/full-observability-contract-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/idp-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/keycloak-realm-admin-adapter-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/observability-control-route-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- observability-proof-signal: apps/platform-api/scripts/observability-metrics-traces-closure-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- observability-proof-signal: apps/platform-api/scripts/observability-provider-closure-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- observability-proof-signal: apps/platform-api/scripts/observability-readiness-route-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- observability-proof-signal: apps/platform-api/scripts/observability-signals-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/oidc-enterprise-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/pitr-restore-drill-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/platform-services-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-billing-catalog-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/postgres-billing-catalog-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/postgres-data-governance-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-email-sender-store-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-identity-repository-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-notification-repository-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/postgres-observability-repository-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/postgres-secret-store-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-storage-object-repository-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-tenant-credential-store-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/postgres-tenant-domain-registry-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/postgres-webhook-store-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/prometheus-metrics-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/prometheus-metrics-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- observability-proof-signal: apps/platform-api/scripts/provider-observability-closure-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- observability-proof-signal: apps/platform-api/scripts/provider-observability-contract-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/secrets-openbao-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/service-catalog-registry-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/smtp-email-adapter-runtime-proof.ts - proof command exited 2
- proof-command-failed: apps/platform-api/scripts/tenant-custom-domain-auth-origin-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/tenant-custom-domain-resolution-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/tenant-domain-canonical-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/tenant-domain-claim-lifecycle-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/tenant-domains-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/tenant-lifecycle-coordinator-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/tenant-observability-runtime-proof.ts - proof command exited 1
- observability-proof-signal: apps/platform-api/scripts/tenant-observability-runtime-proof.ts - observability proof lacks captured trace/log/metric evidence
- proof-command-failed: apps/platform-api/scripts/tenant-storage-objects-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/webhook-redrive-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/webhook-worker-runtime-proof.ts - proof command exited 1
- proof-command-failed: apps/platform-api/scripts/webhooks-runtime-proof.ts - proof command exited 1
- route-proof-evidence-missing: GET /admin/config - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: GET /admin/developer - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: GET /admin/features - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: GET /admin/members - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/admin/alerts - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/alerts/:alertId/evaluate - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/billing/catalog/plans - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/billing/catalog/prices - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/billing/catalog/products - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/admin/data/legal-holds - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/data/legal-holds - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/data/residency - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/admin/data/retention-policies - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/data/retention-policies - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/events/:eventId/redrive - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/governance/catalog - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/governance/catalog/classify - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/governance/dsr - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/governance/dsr/:dsrId/fulfill - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/admin/incidents/:incidentId - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/provider-configs - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/provider-configs/:id/delete - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/provider-configs/:id/lifecycle - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/scheduled-jobs - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/admin/scheduled-jobs/:jobId - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/scheduled-jobs/:jobId/run - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/search/reindex - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/secrets - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/secrets/delete - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/secrets/revoke - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/sub-tenants - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/support-session - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/support-session/approval-grant - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/support-session/approval-request - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/support/tickets - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/announcements - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/auth-settings-credential/repair - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/auth-settings-credential/rotate - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/delegations - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/admin/tenants/:tenantId/delegations/:delegationId - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/delete - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/admin/tenants/:tenantId/entitlements - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/import - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/meter-events - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/notifications/test - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/admin/tenants/:tenantId/quotas - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/admin/tenants/:tenantId/rate-limits - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/:tenantId/suspend - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/tenants/auth-settings-credential - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/workflows/:workflowId/cancel - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/workflows/:workflowId/signal - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/admin/workflows/start - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/auth/settings/domains - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/auth/settings/domains/:domain - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/auth/settings/domains/challenges - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/auth/settings/domains/verify - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/auth/settings/idps - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: DELETE /api/auth/settings/idps/:alias - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: DELETE /api/auth/settings/idps/:alias - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: PATCH /api/auth/settings/idps/:alias - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/auth/settings/idps/:alias - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/auth/settings/idps/:alias/mapping - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: PATCH /api/auth/settings/idps/:alias/mapping - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/auth/settings/idps/:alias/mapping - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/auth/settings/idps/:alias/test-connection - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/auth/settings/idps/oidc/discover - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/auth/settings/lockout - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/auth/settings/mfa - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/auth/settings/providers - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/auth/settings/resource-policies - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/auth/settings/session - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/auth/settings/sysadmin-brokering - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: POST /api/graphql - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/graphql - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/me/notification-preferences - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/me/profile - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/api-keys - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/org/api-keys/:keyId - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/audit - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: GET /api/org/config - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: DELETE /api/org/config/:key - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: DELETE /api/org/config/:key - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: PATCH /api/org/config/:key - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/config/:key - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/developer - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/domains - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/org/domains/:domain - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/domains/:domain/activate - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: DELETE /api/org/domains/:domain/canonical - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: DELETE /api/org/domains/:domain/canonical - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: POST /api/org/domains/:domain/canonical - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/domains/:domain/canonical - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/domains/:domain/deactivate - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/domains/:domain/probe-routing-local - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/domains/:domain/verify - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/email-sender - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: PATCH /api/org/email-sender - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/email-sender - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/email-sender/readiness - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: POST /api/org/email-sender/test - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/email-sender/test - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/features - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: PATCH /api/org/features/:featureKey - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/features/:featureKey - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/groups - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: POST /api/org/groups - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/groups - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: DELETE /api/org/groups/:groupId - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: DELETE /api/org/groups/:groupId - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: PATCH /api/org/groups/:groupId - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/groups/:groupId - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/members - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: DELETE /api/org/members/:userId - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: DELETE /api/org/members/:userId - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: PATCH /api/org/members/:userId - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/members/:userId - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/members/:userId/external-identities - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: PATCH /api/org/members/:userId/status - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/members/:userId/status - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: PATCH /api/org/members/:userId/username - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/members/:userId/username - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: POST /api/org/members/invite - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/members/invite - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: POST /api/org/members/resend-invite - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/members/resend-invite - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/readiness - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/search - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/storage/objects - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/org/storage/objects/:objectKey - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/storage/objects/:objectKey/scan - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/storage/probe - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/org/sub-organisations - route proof has explicit subject refs but no emitted evidence record
- route-proof-evidence-missing: POST /api/org/sub-organisations - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /api/org/sub-organisations - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: DELETE /api/org/sub-organisations/:subOrgId - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: DELETE /api/org/sub-organisations/:subOrgId - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: PATCH /api/org/sub-organisations/:subOrgId - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: PATCH /api/org/sub-organisations/:subOrgId - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/webhooks - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: DELETE /api/org/webhooks/:id - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/org/webhooks/:id - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/webhooks/:id/deliveries/:deliveryId/redrive - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/webhooks/:id/redrive-dead - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/webhooks/:id/rotate-secret - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: POST /api/org/webhooks/:id/test - mutation proof lacks emitted before/after state evidence
- mutation-state-evidence: PATCH /api/organisation/profile - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /api/theme - route proof has explicit subject refs but no emitted evidence record
- mutation-state-evidence: POST /auth/logout - mutation proof lacks emitted before/after state evidence
- route-proof-evidence-missing: GET /e2e-harness - route proof has explicit subject refs but no emitted evidence record
- in-memory-provider-parity: in-memory-antivirus - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-automation-runner - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-backup-restore-provider - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-billing-provider - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-identity-repository - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-notification-transport - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-object-storage - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-observability-repository - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-semantic-provider - in-memory provider lacks complete emitted real-provider parity evidence
- in-memory-provider-parity: in-memory-webhook-dispatcher - in-memory provider lacks complete emitted real-provider parity evidence
- capability-real-provider-proof-missing: Tenant identity (record + FQDN) - Tenant identity (record + FQDN) is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: User identity + tenant membership - User identity + tenant membership is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: End-user profile + preferences self-service - End-user profile + preferences self-service is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: API keys / personal access tokens - API keys / personal access tokens is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Tenant groups - Tenant groups is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Sub-organisations - Sub-organisations is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: RBAC (roles + permissions) - RBAC (roles + permissions) is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: ABAC / Policy Decision Point - ABAC / Policy Decision Point is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: ABAC / Policy Decision Point - ABAC / Policy Decision Point is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Delegated administration roles - Delegated administration roles is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Entitlement engine - Entitlement engine is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Support-mode / break-glass access - Support-mode / break-glass access is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Audit of privileged access - Audit of privileged access is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Platform login + session - Platform login + session is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Platform login + session - Platform login + session is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: IdP brokering + OIDC provider management - IdP brokering + OIDC provider management is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: IdP brokering + OIDC provider management - IdP brokering + OIDC provider management is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Claim mapping + group/role mapping - Claim mapping + group/role mapping is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Claim mapping + group/role mapping - Claim mapping + group/role mapping is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: MFA + session policy + lockout - MFA + session policy + lockout is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: MFA + session policy + lockout - MFA + session policy + lockout is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Configuration registry + history - Configuration registry + history is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Branding + theming - Branding + theming is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Custom domains, DNS ownership, TLS, canonical - Custom domains, DNS ownership, TLS, canonical is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Custom domains, DNS ownership, TLS, canonical - Custom domains, DNS ownership, TLS, canonical is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Write-only secret settings - Write-only secret settings is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Write-only secret settings - Write-only secret settings is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
- capability-real-provider-proof-missing: Product catalog, plans, prices - Product catalog, plans, prices is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-real-provider-proof-missing: Subscriptions, invoices, payment methods, dunning - Subscriptions, invoices, payment methods, dunning is SEMANTIC_PROVEN; missing provider-L4 runtime evidence
- capability-external-sandbox-proof-missing: Subscriptions, invoices, payment methods, dunning - Subscriptions, invoices, payment methods, dunning is SEMANTIC_PROVEN; missing sandbox-L5 runtime evidence
