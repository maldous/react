# Adversarial USF Assurance Attestation

Status: FAIL

This attestation is generated from runtime-derived inventories under `docs/v2-foundation/usf-audit/`.
PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, and orphan checks all have zero gaps.

| Measure                         | Count |
| ------------------------------- | ----: |
| routes discovered               |   235 |
| routes without tracing          |     0 |
| routes without logging          |     0 |
| routes without metrics          |     0 |
| mutations without audit         |     0 |
| capabilities without ownership  |     0 |
| semantic orphans                |     0 |
| runtime orphans                 |     0 |
| provider reliability gaps       |     0 |
| workflow proof gaps             |     0 |
| storage proof gaps              |     0 |
| event runtime gaps              |     0 |
| false-positive items            |     0 |
| external-limited items          |     0 |
| duplicate findings              |     0 |
| obsolete-runtime-artifact items |     0 |
| must-fix-in-v1 items            |   538 |

## Known Gaps Identified

- USF-GAP-0001: GET / - runtime route has no semantic contract definition
- USF-GAP-0002: GET / - route without auth decision
- USF-GAP-0003: GET /admin - route without auth decision
- USF-GAP-0004: GET /admin/account - route without auth decision
- USF-GAP-0005: GET /admin/auth - route without auth decision
- USF-GAP-0006: GET /admin/clickthrough - route without auth decision
- USF-GAP-0007: GET /admin/config - route without auth decision
- USF-GAP-0008: GET /admin/developer - route without auth decision
- USF-GAP-0009: GET /admin/domains - route without auth decision
- USF-GAP-0010: GET /admin/email - route without auth decision
- USF-GAP-0011: GET /admin/entitlements - route without auth decision
- USF-GAP-0012: GET /admin/events - route without auth decision
- USF-GAP-0013: GET /admin/features - route without auth decision
- USF-GAP-0014: GET /admin/logs - route without auth decision
- USF-GAP-0015: GET /admin/members - route without auth decision
- USF-GAP-0016: GET /admin/monitoring - route without auth decision
- USF-GAP-0017: GET /admin/observability - route without auth decision
- USF-GAP-0018: GET /admin/platform - route without auth decision
- USF-GAP-0019: GET /admin/readiness - route without auth decision
- USF-GAP-0020: GET /admin/scheduled-jobs - route without auth decision
- USF-GAP-0021: GET /admin/search - route without auth decision
- USF-GAP-0022: GET /admin/storage - route without auth decision
- USF-GAP-0023: GET /admin/usage - route without auth decision
- USF-GAP-0024: GET /admin/webhooks - route without auth decision
- USF-GAP-0025: GET /api/auth/providers - route without auth decision
- USF-GAP-0026: GET /api/auth/providers - API route without permission decision
- USF-GAP-0027: GET /api/auth/providers - API route without tenant boundary
- USF-GAP-0028: POST /api/auth/settings/domains - API route without tenant boundary
- USF-GAP-0029: DELETE /api/auth/settings/domains/:domain - API route without tenant boundary
- USF-GAP-0030: POST /api/auth/settings/domains/challenges - API route without tenant boundary
- USF-GAP-0031: POST /api/auth/settings/domains/verify - API route without tenant boundary
- USF-GAP-0032: GET /api/auth/settings/idps - API route without tenant boundary
- USF-GAP-0033: POST /api/auth/settings/idps - API route without tenant boundary
- USF-GAP-0034: DELETE /api/auth/settings/idps/:alias - API route without tenant boundary
- USF-GAP-0035: PATCH /api/auth/settings/idps/:alias - API route without tenant boundary
- USF-GAP-0036: GET /api/auth/settings/idps/:alias/callback-url - API route without tenant boundary
- USF-GAP-0037: GET /api/auth/settings/idps/:alias/mapping - API route without tenant boundary
- USF-GAP-0038: PATCH /api/auth/settings/idps/:alias/mapping - API route without tenant boundary
- USF-GAP-0039: POST /api/auth/settings/idps/:alias/test-connection - API route without tenant boundary
- USF-GAP-0040: POST /api/auth/settings/idps/oidc/discover - API route without tenant boundary
- USF-GAP-0041: GET /api/auth/settings/lockout - API route without tenant boundary
- USF-GAP-0042: PATCH /api/auth/settings/lockout - API route without tenant boundary
- USF-GAP-0043: GET /api/auth/settings/mfa - API route without tenant boundary
- USF-GAP-0044: PATCH /api/auth/settings/mfa - API route without tenant boundary
- USF-GAP-0045: GET /api/auth/settings/providers - API route without tenant boundary
- USF-GAP-0046: PATCH /api/auth/settings/providers - API route without tenant boundary
- USF-GAP-0047: GET /api/auth/settings/readiness - API route without tenant boundary
- USF-GAP-0048: GET /api/auth/settings/resource-policies - API route without tenant boundary
- USF-GAP-0049: PATCH /api/auth/settings/resource-policies - API route without tenant boundary
- USF-GAP-0050: GET /api/auth/settings/session - API route without tenant boundary
- USF-GAP-0051: PATCH /api/auth/settings/session - API route without tenant boundary
- USF-GAP-0052: GET /api/auth/settings/sysadmin-brokering - API route without tenant boundary
- USF-GAP-0053: PATCH /api/auth/settings/sysadmin-brokering - API route without tenant boundary
- USF-GAP-0054: POST /api/graphql - API route without permission decision
- USF-GAP-0055: POST /api/graphql - API route without tenant boundary
- USF-GAP-0056: GET /api/host-identity - route without auth decision
- USF-GAP-0057: GET /api/host-identity - API route without permission decision
- USF-GAP-0058: GET /api/host-identity - API route without tenant boundary
- USF-GAP-0059: GET /api/organisation/profile - API route without tenant boundary
- USF-GAP-0060: PATCH /api/organisation/profile - API route without tenant boundary
- USF-GAP-0061: GET /api/platform/service-catalog - API route without tenant boundary
- USF-GAP-0062: GET /api/session - route without auth decision
- USF-GAP-0063: GET /api/session - API route without permission decision
- USF-GAP-0064: GET /api/session - API route without tenant boundary
- USF-GAP-0065: GET /api/theme - route without auth decision
- USF-GAP-0066: GET /api/theme - API route without permission decision
- USF-GAP-0067: GET /api/theme - API route without tenant boundary
- USF-GAP-0068: GET /e2e-harness - route without auth decision
- USF-GAP-0069: GET /internal/auth/forward - route without auth decision
- USF-GAP-0070: GET /login - route without auth decision
- USF-GAP-0071: GET /organisation/profile - route without auth decision
- USF-GAP-0072: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0073: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0074: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0075: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0076: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0077: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0078: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0079: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0080: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0081: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0082: apps/platform-api/scripts/http-provider-readiness-probe-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0083: apps/platform-api/scripts/http-provider-readiness-probe-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0084: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0085: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0086: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0087: apps/platform-api/scripts/in-memory-automation-runner-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0088: apps/platform-api/scripts/in-memory-billing-provider-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0089: apps/platform-api/scripts/in-memory-billing-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0090: apps/platform-api/scripts/in-memory-workflow-orchestrator-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0091: apps/platform-api/scripts/keycloak-realm-admin-adapter-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0092: apps/platform-api/scripts/keycloak-realm-admin-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0093: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0094: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0095: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0096: apps/platform-api/scripts/openapi-drift-validator-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0097: apps/platform-api/scripts/openapi-drift-validator-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0098: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0099: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0100: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0101: apps/platform-api/scripts/playwright-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0102: apps/platform-api/scripts/playwright-adapter-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0103: apps/platform-api/scripts/playwright-axe-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0104: apps/platform-api/scripts/playwright-axe-adapter-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0105: apps/platform-api/scripts/postgres-api-key-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0106: apps/platform-api/scripts/postgres-api-key-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0107: apps/platform-api/scripts/postgres-billing-catalog-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0108: apps/platform-api/scripts/postgres-billing-catalog-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0109: apps/platform-api/scripts/postgres-data-governance-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0110: apps/platform-api/scripts/postgres-data-governance-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0111: apps/platform-api/scripts/postgres-delegated-admin-roles-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0112: apps/platform-api/scripts/postgres-delegated-admin-roles-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0113: apps/platform-api/scripts/postgres-email-sender-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0114: apps/platform-api/scripts/postgres-entitlement-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0115: apps/platform-api/scripts/postgres-entitlement-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0116: apps/platform-api/scripts/postgres-environment-registry-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0117: apps/platform-api/scripts/postgres-environment-registry-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0118: apps/platform-api/scripts/postgres-event-bus-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0119: apps/platform-api/scripts/postgres-event-bus-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0120: apps/platform-api/scripts/postgres-history-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0121: apps/platform-api/scripts/postgres-history-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0122: apps/platform-api/scripts/postgres-identity-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0123: apps/platform-api/scripts/postgres-legal-hold-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0124: apps/platform-api/scripts/postgres-legal-hold-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0125: apps/platform-api/scripts/postgres-metering-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0126: apps/platform-api/scripts/postgres-metering-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0127: apps/platform-api/scripts/postgres-migration-storage-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0128: apps/platform-api/scripts/postgres-migration-storage-provider-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0129: apps/platform-api/scripts/postgres-notification-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0130: apps/platform-api/scripts/postgres-notification-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0131: apps/platform-api/scripts/postgres-observability-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0132: apps/platform-api/scripts/postgres-observability-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0133: apps/platform-api/scripts/postgres-portable-tenant-import-applier-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0134: apps/platform-api/scripts/postgres-portable-tenant-import-applier-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0135: apps/platform-api/scripts/postgres-profile-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0136: apps/platform-api/scripts/postgres-profile-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0137: apps/platform-api/scripts/postgres-provider-config-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0138: apps/platform-api/scripts/postgres-quota-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0139: apps/platform-api/scripts/postgres-quota-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0140: apps/platform-api/scripts/postgres-rate-limit-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0141: apps/platform-api/scripts/postgres-rate-limit-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0142: apps/platform-api/scripts/postgres-retention-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0143: apps/platform-api/scripts/postgres-retention-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0144: apps/platform-api/scripts/postgres-scheduled-job-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0145: apps/platform-api/scripts/postgres-scheduled-job-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0146: apps/platform-api/scripts/postgres-search-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0147: apps/platform-api/scripts/postgres-search-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0148: apps/platform-api/scripts/postgres-secret-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0149: apps/platform-api/scripts/postgres-secret-store-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0150: apps/platform-api/scripts/postgres-storage-object-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0151: apps/platform-api/scripts/postgres-tenant-credential-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0152: apps/platform-api/scripts/postgres-tenant-domain-registry-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0153: apps/platform-api/scripts/postgres-tenant-domain-registry-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0154: apps/platform-api/scripts/postgres-webhook-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0155: apps/platform-api/scripts/postgres-webhook-store-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0156: apps/platform-api/scripts/prometheus-metrics-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0157: apps/platform-api/scripts/provider-observability-closure-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0158: apps/platform-api/scripts/react-i18n-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0159: apps/platform-api/scripts/redis-rate-limit-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0160: apps/platform-api/scripts/redis-rate-limit-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0161: apps/platform-api/scripts/s3-object-storage-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0162: apps/platform-api/scripts/s3-object-storage-adapter-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0163: apps/platform-api/scripts/smtp-email-adapter-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0164: apps/platform-api/scripts/smtp-email-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0165: apps/platform-api/scripts/static-assurance-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0166: apps/platform-api/scripts/static-assurance-provider-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0167: apps/platform-api/scripts/tenant-lifecycle-coordinator-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0168: apps/platform-api/scripts/tenant-lifecycle-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0169: apps/platform-api/scripts/tenant-secret-crypto-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0170: apps/platform-api/scripts/tenant-secret-crypto-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0171: GET /api/admin/alerts - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0172: POST /api/admin/alerts - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0173: POST /api/admin/alerts/:alertId/evaluate - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0174: GET /api/admin/backup - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0175: GET /api/admin/billing - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0176: GET /api/admin/billing/catalog/plans - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0177: POST /api/admin/billing/catalog/plans - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0178: GET /api/admin/billing/catalog/prices - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0179: POST /api/admin/billing/catalog/prices - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0180: GET /api/admin/billing/catalog/products - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0181: POST /api/admin/billing/catalog/products - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0182: GET /api/admin/billing/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0183: GET /api/admin/clickthrough - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0184: GET /api/admin/data/compliance-report - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0185: DELETE /api/admin/data/legal-holds - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0186: GET /api/admin/data/legal-holds - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0187: POST /api/admin/data/legal-holds - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0188: POST /api/admin/data/residency - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0189: DELETE /api/admin/data/retention-policies - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0190: GET /api/admin/data/retention-policies - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0191: POST /api/admin/data/retention-policies - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0192: GET /api/admin/events - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0193: POST /api/admin/events/:eventId/redrive - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0194: GET /api/admin/events/dead-letter - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0195: GET /api/admin/governance/catalog - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0196: POST /api/admin/governance/catalog - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0197: POST /api/admin/governance/catalog/classify - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0198: GET /api/admin/governance/dsr - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0199: POST /api/admin/governance/dsr - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0200: POST /api/admin/governance/dsr/:dsrId/fulfill - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0201: GET /api/admin/incidents - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0202: PATCH /api/admin/incidents/:incidentId - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0203: GET /api/admin/logs/search - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0204: GET /api/admin/notifications/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0205: GET /api/admin/observability - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0206: GET /api/admin/observability/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0207: GET /api/admin/observability/signals - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0208: GET /api/admin/provider-bindings - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0209: GET /api/admin/provider-configs - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0210: POST /api/admin/provider-configs - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0211: POST /api/admin/provider-configs/:id/delete - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0212: POST /api/admin/provider-configs/:id/lifecycle - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0213: GET /api/admin/providers/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0214: GET /api/admin/scheduled-jobs - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0215: POST /api/admin/scheduled-jobs - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0216: PATCH /api/admin/scheduled-jobs/:jobId - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0217: POST /api/admin/scheduled-jobs/:jobId/run - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0218: GET /api/admin/search/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0219: POST /api/admin/search/reindex - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0220: GET /api/admin/secrets - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0221: POST /api/admin/secrets - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0222: POST /api/admin/secrets/delete - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0223: GET /api/admin/secrets/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0224: POST /api/admin/secrets/revoke - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0225: GET /api/admin/security - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0226: POST /api/admin/sub-tenants - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0227: POST /api/admin/support-session - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0228: POST /api/admin/support-session/approval-grant - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0229: POST /api/admin/support-session/approval-request - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0230: GET /api/admin/support/health - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0231: GET /api/admin/support/tickets - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0232: POST /api/admin/support/tickets - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0233: GET /api/admin/tenants - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0234: POST /api/admin/tenants - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0235: GET /api/admin/tenants/:tenantId/announcements - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0236: POST /api/admin/tenants/:tenantId/announcements - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0237: GET /api/admin/tenants/:tenantId/api-keys - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0238: GET /api/admin/tenants/:tenantId/auth-settings-credential/readiness - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0239: POST /api/admin/tenants/:tenantId/auth-settings-credential/repair - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0240: POST /api/admin/tenants/:tenantId/auth-settings-credential/rotate - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0241: GET /api/admin/tenants/:tenantId/delegations - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0242: POST /api/admin/tenants/:tenantId/delegations - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0243: DELETE /api/admin/tenants/:tenantId/delegations/:delegationId - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0244: POST /api/admin/tenants/:tenantId/delete - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0245: GET /api/admin/tenants/:tenantId/entitlements - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0246: PATCH /api/admin/tenants/:tenantId/entitlements - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0247: GET /api/admin/tenants/:tenantId/export - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0248: GET /api/admin/tenants/:tenantId/history - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0249: POST /api/admin/tenants/:tenantId/import - route without route-specific alert condition/owner/runbook proof
- USF-GAP-0250: POST /api/admin/tenants/:tenantId/meter-events - route without route-specific alert condition/owner/runbook proof
