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
| event runtime gaps              |     2 |
| false-positive items            |     0 |
| external-limited items          |     0 |
| duplicate findings              |     0 |
| obsolete-runtime-artifact items |     0 |
| must-fix-in-v1 items            |   694 |

## Known Gaps Identified

- USF-GAP-0001: GET / - runtime route has no semantic contract definition
- USF-GAP-0002: npm run api:start - runtime command has no semantic catalogue link
- USF-GAP-0003: npm run api:start:admin - runtime command has no semantic catalogue link
- USF-GAP-0004: npm run api:start:viewer - runtime command has no semantic catalogue link
- USF-GAP-0005: npm run audit:deps - runtime command has no semantic catalogue link
- USF-GAP-0006: npm run build:spa - runtime command has no semantic catalogue link
- USF-GAP-0007: npm run codeql:analyze - runtime command has no semantic catalogue link
- USF-GAP-0008: npm run codeql:db - runtime command has no semantic catalogue link
- USF-GAP-0009: npm run codeql:validate - runtime command has no semantic catalogue link
- USF-GAP-0010: npm run compose:cloud - runtime command has no semantic catalogue link
- USF-GAP-0011: npm run compose:down - runtime command has no semantic catalogue link
- USF-GAP-0012: npm run compose:down:volumes - runtime command has no semantic catalogue link
- USF-GAP-0013: npm run compose:external-mocks - runtime command has no semantic catalogue link
- USF-GAP-0014: npm run compose:identity - runtime command has no semantic catalogue link
- USF-GAP-0015: npm run compose:logs - runtime command has no semantic catalogue link
- USF-GAP-0016: npm run compose:ps - runtime command has no semantic catalogue link
- USF-GAP-0017: npm run compose:sentry - runtime command has no semantic catalogue link
- USF-GAP-0018: npm run compose:up - runtime command has no semantic catalogue link
- USF-GAP-0019: npm run compose:up:default - runtime command has no semantic catalogue link
- USF-GAP-0020: npm run coverage:normalize - runtime command has no semantic catalogue link
- USF-GAP-0021: npm run db:reset - runtime command has no semantic catalogue link
- USF-GAP-0022: npm run e2e:accessibility - runtime command has no semantic catalogue link
- USF-GAP-0023: npm run e2e:coverage:validate - runtime command has no semantic catalogue link
- USF-GAP-0024: npm run e2e:failure:rootcause - runtime command has no semantic catalogue link
- USF-GAP-0025: npm run e2e:observability:correlate - runtime command has no semantic catalogue link
- USF-GAP-0026: npm run e2e:persona:authz - runtime command has no semantic catalogue link
- USF-GAP-0027: npm run e2e:personas:validate - runtime command has no semantic catalogue link
- USF-GAP-0028: npm run e2e:registry:validate - runtime command has no semantic catalogue link
- USF-GAP-0029: npm run e2e:scenario:validate - runtime command has no semantic catalogue link
- USF-GAP-0030: npm run e2e:sentry:assert - runtime command has no semantic catalogue link
- USF-GAP-0031: npm run e2e:ui:contract:validate - runtime command has no semantic catalogue link
- USF-GAP-0032: npm run e2e:ui:discover - runtime command has no semantic catalogue link
- USF-GAP-0033: npm run format:check - runtime command has no semantic catalogue link
- USF-GAP-0034: npm run format:write - runtime command has no semantic catalogue link
- USF-GAP-0035: npm run frontend:conventions - runtime command has no semantic catalogue link
- USF-GAP-0036: npm run generate:feature - runtime command has no semantic catalogue link
- USF-GAP-0037: npm run license:policy - runtime command has no semantic catalogue link
- USF-GAP-0038: npm run lint:md - runtime command has no semantic catalogue link
- USF-GAP-0039: npm run mcp:governor - runtime command has no semantic catalogue link
- USF-GAP-0040: npm run mcp:governor:selftest - runtime command has no semantic catalogue link
- USF-GAP-0041: npm run proof:alert-incident-closure - runtime command has no semantic catalogue link
- USF-GAP-0042: npm run proof:approval-workflow - runtime command has no semantic catalogue link
- USF-GAP-0043: npm run proof:auth-credential-lifecycle - runtime command has no semantic catalogue link
- USF-GAP-0044: npm run proof:backup-control-route - runtime command has no semantic catalogue link
- USF-GAP-0045: npm run proof:billing-control-route - runtime command has no semantic catalogue link
- USF-GAP-0046: npm run proof:billing-readiness-route - runtime command has no semantic catalogue link
- USF-GAP-0047: npm run proof:composed-provider-runtime-closure - runtime command has no semantic catalogue link
- USF-GAP-0048: npm run proof:email-sender - runtime command has no semantic catalogue link
- USF-GAP-0049: npm run proof:full-observability-contract - runtime command has no semantic catalogue link
- USF-GAP-0050: npm run proof:http-engine-providers - runtime command has no semantic catalogue link
- USF-GAP-0051: npm run proof:observability-control-route - runtime command has no semantic catalogue link
- USF-GAP-0052: npm run proof:observability-metrics-traces-closure - runtime command has no semantic catalogue link
- USF-GAP-0053: npm run proof:observability-provider-closure - runtime command has no semantic catalogue link
- USF-GAP-0054: npm run proof:observability-readiness-route - runtime command has no semantic catalogue link
- USF-GAP-0055: npm run proof:provider-binding-report-route - runtime command has no semantic catalogue link
- USF-GAP-0056: npm run proof:provider-observability-closure - runtime command has no semantic catalogue link
- USF-GAP-0057: npm run proof:provider-observability-contract - runtime command has no semantic catalogue link
- USF-GAP-0058: npm run proof:security-control-route - runtime command has no semantic catalogue link
- USF-GAP-0059: npm run proof:typed-secret-resolution - runtime command has no semantic catalogue link
- USF-GAP-0060: npm run proof:webhook-worker - runtime command has no semantic catalogue link
- USF-GAP-0061: npm run proof:workflow-adapters - runtime command has no semantic catalogue link
- USF-GAP-0062: npm run proof:workflow-closure - runtime command has no semantic catalogue link
- USF-GAP-0063: npm run proof:workflow-control-route - runtime command has no semantic catalogue link
- USF-GAP-0064: npm run proof:workflow-engine - runtime command has no semantic catalogue link
- USF-GAP-0065: npm run proof:workflow-readiness-route - runtime command has no semantic catalogue link
- USF-GAP-0066: npm run sbom:generate - runtime command has no semantic catalogue link
- USF-GAP-0067: npm run sbom:policy - runtime command has no semantic catalogue link
- USF-GAP-0068: npm run sbom:verify - runtime command has no semantic catalogue link
- USF-GAP-0069: npm run secrets:scan - runtime command has no semantic catalogue link
- USF-GAP-0070: npm run seed:idps - runtime command has no semantic catalogue link
- USF-GAP-0071: npm run semgrep:json - runtime command has no semantic catalogue link
- USF-GAP-0072: npm run test:e2e:build - runtime command has no semantic catalogue link
- USF-GAP-0073: npm run test:e2e:external - runtime command has no semantic catalogue link
- USF-GAP-0074: npm run test:e2e:internal - runtime command has no semantic catalogue link
- USF-GAP-0075: npm run test:e2e:report - runtime command has no semantic catalogue link
- USF-GAP-0076: npm run test:e2e:ui - runtime command has no semantic catalogue link
- USF-GAP-0077: npm run test:mock-oidc - runtime command has no semantic catalogue link
- USF-GAP-0078: npm run test:platform-api:unit-safe - runtime command has no semantic catalogue link
- USF-GAP-0079: npm run test:security - runtime command has no semantic catalogue link
- USF-GAP-0080: npm run tsc:check - runtime command has no semantic catalogue link
- USF-GAP-0081: npm run tsc:check:api - runtime command has no semantic catalogue link
- USF-GAP-0082: npm run tsc:check:packages - runtime command has no semantic catalogue link
- USF-GAP-0083: npm run ui:harness - runtime command has no semantic catalogue link
- USF-GAP-0084: npm run ui:harness:e2e - runtime command has no semantic catalogue link
- USF-GAP-0085: npm run ui:harness:test - runtime command has no semantic catalogue link
- USF-GAP-0086: npm run usf:render - runtime command has no semantic catalogue link
- USF-GAP-0087: npm run v2:adversarial-usf-audit - runtime command has no semantic catalogue link
- USF-GAP-0088: npm run v2:formal-assurance - runtime command has no semantic catalogue link
- USF-GAP-0089: npm run v2:readiness:json - runtime command has no semantic catalogue link
- USF-GAP-0090: npm run v2:usf-assurance - runtime command has no semantic catalogue link
- USF-GAP-0091: npm run validate:slices - runtime command has no semantic catalogue link
- USF-GAP-0092: retention-tick - runtime worker has no semantic worker/event link
- USF-GAP-0093: adapters-object-storage.test - runtime storage operation has no semantic storage link
- USF-GAP-0094: storage-runtime.test - runtime storage operation has no semantic storage link
- USF-GAP-0095: workflow-control - runtime workflow has no semantic workflow/state-machine link
- USF-GAP-0096: workflow-readiness - runtime workflow has no semantic workflow/state-machine link
- USF-GAP-0097: GET / - route without auth decision
- USF-GAP-0098: GET /admin - route without auth decision
- USF-GAP-0099: GET /admin/account - route without auth decision
- USF-GAP-0100: GET /admin/auth - route without auth decision
- USF-GAP-0101: GET /admin/clickthrough - route without auth decision
- USF-GAP-0102: GET /admin/config - route without auth decision
- USF-GAP-0103: GET /admin/developer - route without auth decision
- USF-GAP-0104: GET /admin/domains - route without auth decision
- USF-GAP-0105: GET /admin/email - route without auth decision
- USF-GAP-0106: GET /admin/entitlements - route without auth decision
- USF-GAP-0107: GET /admin/events - route without auth decision
- USF-GAP-0108: GET /admin/features - route without auth decision
- USF-GAP-0109: GET /admin/logs - route without auth decision
- USF-GAP-0110: GET /admin/members - route without auth decision
- USF-GAP-0111: GET /admin/monitoring - route without auth decision
- USF-GAP-0112: GET /admin/observability - route without auth decision
- USF-GAP-0113: GET /admin/platform - route without auth decision
- USF-GAP-0114: GET /admin/readiness - route without auth decision
- USF-GAP-0115: GET /admin/scheduled-jobs - route without auth decision
- USF-GAP-0116: GET /admin/search - route without auth decision
- USF-GAP-0117: GET /admin/storage - route without auth decision
- USF-GAP-0118: GET /admin/usage - route without auth decision
- USF-GAP-0119: GET /admin/webhooks - route without auth decision
- USF-GAP-0120: GET /api/admin/logs/search - admin route without route-level RBAC/ABAC/PDP evidence
- USF-GAP-0121: GET /api/auth/providers - route without auth decision
- USF-GAP-0122: GET /api/auth/providers - API route without permission decision
- USF-GAP-0123: GET /api/auth/providers - API route without tenant boundary
- USF-GAP-0124: POST /api/auth/settings/domains - API route without tenant boundary
- USF-GAP-0125: DELETE /api/auth/settings/domains/:domain - API route without tenant boundary
- USF-GAP-0126: POST /api/auth/settings/domains/challenges - API route without tenant boundary
- USF-GAP-0127: POST /api/auth/settings/domains/verify - API route without tenant boundary
- USF-GAP-0128: GET /api/auth/settings/idps - API route without tenant boundary
- USF-GAP-0129: POST /api/auth/settings/idps - API route without tenant boundary
- USF-GAP-0130: DELETE /api/auth/settings/idps/:alias - API route without tenant boundary
- USF-GAP-0131: PATCH /api/auth/settings/idps/:alias - API route without tenant boundary
- USF-GAP-0132: GET /api/auth/settings/idps/:alias/callback-url - API route without tenant boundary
- USF-GAP-0133: GET /api/auth/settings/idps/:alias/mapping - API route without tenant boundary
- USF-GAP-0134: PATCH /api/auth/settings/idps/:alias/mapping - API route without tenant boundary
- USF-GAP-0135: POST /api/auth/settings/idps/:alias/test-connection - API route without tenant boundary
- USF-GAP-0136: POST /api/auth/settings/idps/oidc/discover - API route without tenant boundary
- USF-GAP-0137: GET /api/auth/settings/lockout - API route without tenant boundary
- USF-GAP-0138: PATCH /api/auth/settings/lockout - API route without tenant boundary
- USF-GAP-0139: GET /api/auth/settings/mfa - API route without tenant boundary
- USF-GAP-0140: PATCH /api/auth/settings/mfa - API route without tenant boundary
- USF-GAP-0141: GET /api/auth/settings/providers - API route without tenant boundary
- USF-GAP-0142: PATCH /api/auth/settings/providers - API route without tenant boundary
- USF-GAP-0143: GET /api/auth/settings/readiness - API route without tenant boundary
- USF-GAP-0144: GET /api/auth/settings/resource-policies - API route without tenant boundary
- USF-GAP-0145: PATCH /api/auth/settings/resource-policies - API route without tenant boundary
- USF-GAP-0146: GET /api/auth/settings/session - API route without tenant boundary
- USF-GAP-0147: PATCH /api/auth/settings/session - API route without tenant boundary
- USF-GAP-0148: GET /api/auth/settings/sysadmin-brokering - API route without tenant boundary
- USF-GAP-0149: PATCH /api/auth/settings/sysadmin-brokering - API route without tenant boundary
- USF-GAP-0150: POST /api/graphql - API route without permission decision
- USF-GAP-0151: POST /api/graphql - API route without tenant boundary
- USF-GAP-0152: GET /api/host-identity - route without auth decision
- USF-GAP-0153: GET /api/host-identity - API route without permission decision
- USF-GAP-0154: GET /api/host-identity - API route without tenant boundary
- USF-GAP-0155: GET /api/organisation/profile - API route without tenant boundary
- USF-GAP-0156: PATCH /api/organisation/profile - API route without tenant boundary
- USF-GAP-0157: GET /api/platform/service-catalog - API route without tenant boundary
- USF-GAP-0158: GET /api/session - route without auth decision
- USF-GAP-0159: GET /api/session - API route without permission decision
- USF-GAP-0160: GET /api/session - API route without tenant boundary
- USF-GAP-0161: GET /api/theme - route without auth decision
- USF-GAP-0162: GET /api/theme - API route without permission decision
- USF-GAP-0163: GET /api/theme - API route without tenant boundary
- USF-GAP-0164: GET /e2e-harness - route without auth decision
- USF-GAP-0165: GET /internal/auth/forward - route without auth decision
- USF-GAP-0166: GET /login - route without auth decision
- USF-GAP-0167: GET /organisation/profile - route without auth decision
- USF-GAP-0168: apps/platform-api/scripts/alerting-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0169: apps/platform-api/scripts/auth-settings-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0170: apps/platform-api/scripts/backup-local-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0171: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0172: apps/platform-api/scripts/backup-restore-scripts-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0173: apps/platform-api/scripts/billing-catalog-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0174: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0175: apps/platform-api/scripts/browser-telemetry-provider-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0176: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0177: apps/platform-api/scripts/caddy-local-routing-probe-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0178: apps/platform-api/scripts/clamav-antivirus-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0179: apps/platform-api/scripts/clickthrough-services-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0180: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0181: apps/platform-api/scripts/compose-environment-operation-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0182: apps/platform-api/scripts/composed-provider-readiness-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0183: apps/platform-api/scripts/dashboards-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0184: apps/platform-api/scripts/domain-identity-matrix-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0185: apps/platform-api/scripts/email-sender-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0186: apps/platform-api/scripts/entitlement-policy-chain-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0187: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0188: apps/platform-api/scripts/environment-admin-bootstrap-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0189: apps/platform-api/scripts/environment-operations-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0190: apps/platform-api/scripts/environment-registry-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0191: apps/platform-api/scripts/event-bus-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0192: apps/platform-api/scripts/history-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0193: apps/platform-api/scripts/http-provider-readiness-probe-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0194: apps/platform-api/scripts/http-provider-readiness-probe-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0195: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0196: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0197: apps/platform-api/scripts/http-webhook-dispatcher-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0198: apps/platform-api/scripts/idp-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0199: apps/platform-api/scripts/in-memory-automation-runner-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0200: apps/platform-api/scripts/in-memory-billing-provider-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0201: apps/platform-api/scripts/in-memory-billing-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0202: apps/platform-api/scripts/in-memory-workflow-orchestrator-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0203: apps/platform-api/scripts/incident-foundation-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0204: apps/platform-api/scripts/keycloak-realm-admin-adapter-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0205: apps/platform-api/scripts/keycloak-realm-admin-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0206: apps/platform-api/scripts/metering-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0207: apps/platform-api/scripts/metrics-prometheus-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0208: apps/platform-api/scripts/notification-email-transport-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0209: apps/platform-api/scripts/notification-preferences-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0210: apps/platform-api/scripts/notification-transport-routes-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0211: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0212: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0213: apps/platform-api/scripts/notification-transports-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0214: apps/platform-api/scripts/notification-webhook-transport-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0215: apps/platform-api/scripts/observability-signals-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0216: apps/platform-api/scripts/oidc-enterprise-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0217: apps/platform-api/scripts/openapi-drift-validator-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0218: apps/platform-api/scripts/openapi-drift-validator-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0219: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof only checks file/contract shape
- USF-GAP-0220: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0221: apps/platform-api/scripts/openbao-secret-store-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0222: apps/platform-api/scripts/platform-services-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0223: apps/platform-api/scripts/playwright-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0224: apps/platform-api/scripts/playwright-adapter-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0225: apps/platform-api/scripts/playwright-axe-adapter-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0226: apps/platform-api/scripts/playwright-axe-adapter-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0227: apps/platform-api/scripts/postgres-api-key-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0228: apps/platform-api/scripts/postgres-api-key-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0229: apps/platform-api/scripts/postgres-billing-catalog-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0230: apps/platform-api/scripts/postgres-billing-catalog-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0231: apps/platform-api/scripts/postgres-data-governance-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0232: apps/platform-api/scripts/postgres-data-governance-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0233: apps/platform-api/scripts/postgres-delegated-admin-roles-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0234: apps/platform-api/scripts/postgres-delegated-admin-roles-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0235: apps/platform-api/scripts/postgres-email-sender-store-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0236: apps/platform-api/scripts/postgres-entitlement-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0237: apps/platform-api/scripts/postgres-entitlement-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0238: apps/platform-api/scripts/postgres-environment-registry-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0239: apps/platform-api/scripts/postgres-environment-registry-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0240: apps/platform-api/scripts/postgres-event-bus-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0241: apps/platform-api/scripts/postgres-event-bus-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0242: apps/platform-api/scripts/postgres-history-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0243: apps/platform-api/scripts/postgres-history-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0244: apps/platform-api/scripts/postgres-identity-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0245: apps/platform-api/scripts/postgres-legal-hold-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0246: apps/platform-api/scripts/postgres-legal-hold-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0247: apps/platform-api/scripts/postgres-metering-repository-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0248: apps/platform-api/scripts/postgres-metering-repository-runtime-proof.ts - proof does not assert failure mode
- USF-GAP-0249: apps/platform-api/scripts/postgres-migration-storage-provider-runtime-proof.ts - proof does not assert side effects
- USF-GAP-0250: apps/platform-api/scripts/postgres-migration-storage-provider-runtime-proof.ts - proof does not assert failure mode
