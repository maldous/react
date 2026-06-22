# Adversarial USF Assurance Attestation

Status: FAIL

This attestation is generated from runtime-derived inventories under `docs/v2-foundation/usf-audit/`.
PASS is not allowed unless runtime/interface-level route, security, ownership, audit, proof, storage, workflow, event, metrics, data-governance, provider, and orphan checks all have zero gaps.

| Measure                         | Count |
| ------------------------------- | ----: |
| routes discovered               |   235 |
| routes without tracing          |    28 |
| routes without logging          |    28 |
| routes without metrics          |    28 |
| mutations without audit         |   101 |
| capabilities without ownership  |   158 |
| semantic orphans                |     7 |
| runtime orphans                 |    32 |
| provider reliability gaps       |  2570 |
| workflow proof gaps             |   106 |
| storage proof gaps              |   114 |
| event runtime gaps              |     2 |
| false-positive items            |     0 |
| external-limited items          |     0 |
| duplicate findings              |     0 |
| obsolete-runtime-artifact items |     0 |
| must-fix-in-v1 items            |  4327 |

## Known Gaps Identified

- USF-GAP-0001: GET / - runtime route has no semantic contract definition
- USF-GAP-0002: GET /admin - runtime route has no semantic contract definition
- USF-GAP-0003: GET /admin/account - runtime route has no semantic contract definition
- USF-GAP-0004: GET /admin/auth - runtime route has no semantic contract definition
- USF-GAP-0005: GET /admin/clickthrough - runtime route has no semantic contract definition
- USF-GAP-0006: GET /admin/config - runtime route has no semantic contract definition
- USF-GAP-0007: GET /admin/developer - runtime route has no semantic contract definition
- USF-GAP-0008: GET /admin/domains - runtime route has no semantic contract definition
- USF-GAP-0009: GET /admin/email - runtime route has no semantic contract definition
- USF-GAP-0010: GET /admin/entitlements - runtime route has no semantic contract definition
- USF-GAP-0011: GET /admin/events - runtime route has no semantic contract definition
- USF-GAP-0012: GET /admin/features - runtime route has no semantic contract definition
- USF-GAP-0013: GET /admin/logs - runtime route has no semantic contract definition
- USF-GAP-0014: GET /admin/members - runtime route has no semantic contract definition
- USF-GAP-0015: GET /admin/monitoring - runtime route has no semantic contract definition
- USF-GAP-0016: GET /admin/observability - runtime route has no semantic contract definition
- USF-GAP-0017: GET /admin/platform - runtime route has no semantic contract definition
- USF-GAP-0018: GET /admin/readiness - runtime route has no semantic contract definition
- USF-GAP-0019: GET /admin/scheduled-jobs - runtime route has no semantic contract definition
- USF-GAP-0020: GET /admin/search - runtime route has no semantic contract definition
- USF-GAP-0021: GET /admin/storage - runtime route has no semantic contract definition
- USF-GAP-0022: GET /admin/usage - runtime route has no semantic contract definition
- USF-GAP-0023: GET /admin/webhooks - runtime route has no semantic contract definition
- USF-GAP-0024: GET /api/admin/alerts - runtime route has no semantic contract definition
- USF-GAP-0025: POST /api/admin/alerts - runtime route has no semantic contract definition
- USF-GAP-0026: POST /api/admin/alerts/:alertId/evaluate - runtime route has no semantic contract definition
- USF-GAP-0027: GET /api/admin/backup - runtime route has no semantic contract definition
- USF-GAP-0028: GET /api/admin/billing - runtime route has no semantic contract definition
- USF-GAP-0029: GET /api/admin/billing/catalog/plans - runtime route has no semantic contract definition
- USF-GAP-0030: POST /api/admin/billing/catalog/plans - runtime route has no semantic contract definition
- USF-GAP-0031: GET /api/admin/billing/catalog/prices - runtime route has no semantic contract definition
- USF-GAP-0032: POST /api/admin/billing/catalog/prices - runtime route has no semantic contract definition
- USF-GAP-0033: GET /api/admin/billing/catalog/products - runtime route has no semantic contract definition
- USF-GAP-0034: GET /api/admin/billing/readiness - runtime route has no semantic contract definition
- USF-GAP-0035: GET /api/admin/clickthrough - runtime route has no semantic contract definition
- USF-GAP-0036: DELETE /api/admin/data/legal-holds - runtime route has no semantic contract definition
- USF-GAP-0037: GET /api/admin/data/legal-holds - runtime route has no semantic contract definition
- USF-GAP-0038: POST /api/admin/data/legal-holds - runtime route has no semantic contract definition
- USF-GAP-0039: POST /api/admin/data/residency - runtime route has no semantic contract definition
- USF-GAP-0040: DELETE /api/admin/data/retention-policies - runtime route has no semantic contract definition
- USF-GAP-0041: GET /api/admin/data/retention-policies - runtime route has no semantic contract definition
- USF-GAP-0042: POST /api/admin/data/retention-policies - runtime route has no semantic contract definition
- USF-GAP-0043: GET /api/admin/events - runtime route has no semantic contract definition
- USF-GAP-0044: POST /api/admin/events/:eventId/redrive - runtime route has no semantic contract definition
- USF-GAP-0045: GET /api/admin/events/dead-letter - runtime route has no semantic contract definition
- USF-GAP-0046: GET /api/admin/governance/catalog - runtime route has no semantic contract definition
- USF-GAP-0047: POST /api/admin/governance/catalog - runtime route has no semantic contract definition
- USF-GAP-0048: POST /api/admin/governance/catalog/classify - runtime route has no semantic contract definition
- USF-GAP-0049: GET /api/admin/governance/dsr - runtime route has no semantic contract definition
- USF-GAP-0050: POST /api/admin/governance/dsr - runtime route has no semantic contract definition
- USF-GAP-0051: POST /api/admin/governance/dsr/:dsrId/fulfill - runtime route has no semantic contract definition
- USF-GAP-0052: GET /api/admin/incidents - runtime route has no semantic contract definition
- USF-GAP-0053: PATCH /api/admin/incidents/:incidentId - runtime route has no semantic contract definition
- USF-GAP-0054: GET /api/admin/notifications/readiness - runtime route has no semantic contract definition
- USF-GAP-0055: GET /api/admin/observability - runtime route has no semantic contract definition
- USF-GAP-0056: GET /api/admin/observability/readiness - runtime route has no semantic contract definition
- USF-GAP-0057: GET /api/admin/observability/signals - runtime route has no semantic contract definition
- USF-GAP-0058: GET /api/admin/provider-bindings - runtime route has no semantic contract definition
- USF-GAP-0059: GET /api/admin/provider-configs - runtime route has no semantic contract definition
- USF-GAP-0060: GET /api/admin/scheduled-jobs - runtime route has no semantic contract definition
- USF-GAP-0061: POST /api/admin/scheduled-jobs - runtime route has no semantic contract definition
- USF-GAP-0062: PATCH /api/admin/scheduled-jobs/:jobId - runtime route has no semantic contract definition
- USF-GAP-0063: POST /api/admin/scheduled-jobs/:jobId/run - runtime route has no semantic contract definition
- USF-GAP-0064: GET /api/admin/search/readiness - runtime route has no semantic contract definition
- USF-GAP-0065: POST /api/admin/search/reindex - runtime route has no semantic contract definition
- USF-GAP-0066: GET /api/admin/secrets - runtime route has no semantic contract definition
- USF-GAP-0067: POST /api/admin/secrets/delete - runtime route has no semantic contract definition
- USF-GAP-0068: GET /api/admin/security - runtime route has no semantic contract definition
- USF-GAP-0069: POST /api/admin/sub-tenants - runtime route has no semantic contract definition
- USF-GAP-0070: POST /api/admin/support-session/approval-grant - runtime route has no semantic contract definition
- USF-GAP-0071: POST /api/admin/support-session/approval-request - runtime route has no semantic contract definition
- USF-GAP-0072: GET /api/admin/support/health - runtime route has no semantic contract definition
- USF-GAP-0073: GET /api/admin/support/tickets - runtime route has no semantic contract definition
- USF-GAP-0074: POST /api/admin/support/tickets - runtime route has no semantic contract definition
- USF-GAP-0075: GET /api/admin/tenants - runtime route has no semantic contract definition
- USF-GAP-0076: GET /api/admin/tenants/:tenantId/announcements - runtime route has no semantic contract definition
- USF-GAP-0077: POST /api/admin/tenants/:tenantId/announcements - runtime route has no semantic contract definition
- USF-GAP-0078: GET /api/admin/tenants/:tenantId/api-keys - runtime route has no semantic contract definition
- USF-GAP-0079: GET /api/admin/tenants/:tenantId/auth-settings-credential/readiness - runtime route has no semantic contract definition
- USF-GAP-0080: POST /api/admin/tenants/:tenantId/auth-settings-credential/repair - runtime route has no semantic contract definition
- USF-GAP-0081: POST /api/admin/tenants/:tenantId/auth-settings-credential/rotate - runtime route has no semantic contract definition
- USF-GAP-0082: POST /api/admin/tenants/:tenantId/delegations - runtime route has no semantic contract definition
- USF-GAP-0083: POST /api/admin/tenants/:tenantId/delete - runtime route has no semantic contract definition
- USF-GAP-0084: GET /api/admin/tenants/:tenantId/entitlements - runtime route has no semantic contract definition
- USF-GAP-0085: GET /api/admin/tenants/:tenantId/export - runtime route has no semantic contract definition
- USF-GAP-0086: POST /api/admin/tenants/:tenantId/import - runtime route has no semantic contract definition
- USF-GAP-0087: POST /api/admin/tenants/:tenantId/notifications/test - runtime route has no semantic contract definition
- USF-GAP-0088: GET /api/admin/tenants/:tenantId/quotas - runtime route has no semantic contract definition
- USF-GAP-0089: GET /api/admin/tenants/:tenantId/rate-limits - runtime route has no semantic contract definition
- USF-GAP-0090: PATCH /api/admin/tenants/:tenantId/rate-limits - runtime route has no semantic contract definition
- USF-GAP-0091: POST /api/admin/tenants/:tenantId/suspend - runtime route has no semantic contract definition
- USF-GAP-0092: POST /api/admin/tenants/auth-settings-credential - runtime route has no semantic contract definition
- USF-GAP-0093: GET /api/admin/tenants/resources - runtime route has no semantic contract definition
- USF-GAP-0094: GET /api/admin/workers - runtime route has no semantic contract definition
- USF-GAP-0095: GET /api/admin/workflows - runtime route has no semantic contract definition
- USF-GAP-0096: GET /api/admin/workflows/:workflowId - runtime route has no semantic contract definition
- USF-GAP-0097: POST /api/admin/workflows/:workflowId/cancel - runtime route has no semantic contract definition
- USF-GAP-0098: POST /api/admin/workflows/:workflowId/signal - runtime route has no semantic contract definition
- USF-GAP-0099: GET /api/admin/workflows/readiness - runtime route has no semantic contract definition
- USF-GAP-0100: POST /api/admin/workflows/start - runtime route has no semantic contract definition
- USF-GAP-0101: GET /api/auth/providers - runtime route has no semantic contract definition
- USF-GAP-0102: POST /api/auth/settings/domains - runtime route has no semantic contract definition
- USF-GAP-0103: DELETE /api/auth/settings/domains/:domain - runtime route has no semantic contract definition
- USF-GAP-0104: POST /api/auth/settings/domains/challenges - runtime route has no semantic contract definition
- USF-GAP-0105: POST /api/auth/settings/domains/verify - runtime route has no semantic contract definition
- USF-GAP-0106: GET /api/auth/settings/idps - runtime route has no semantic contract definition
- USF-GAP-0107: POST /api/auth/settings/idps - runtime route has no semantic contract definition
- USF-GAP-0108: DELETE /api/auth/settings/idps/:alias - runtime route has no semantic contract definition
- USF-GAP-0109: PATCH /api/auth/settings/idps/:alias - runtime route has no semantic contract definition
- USF-GAP-0110: GET /api/auth/settings/idps/:alias/callback-url - runtime route has no semantic contract definition
- USF-GAP-0111: GET /api/auth/settings/idps/:alias/mapping - runtime route has no semantic contract definition
- USF-GAP-0112: PATCH /api/auth/settings/idps/:alias/mapping - runtime route has no semantic contract definition
- USF-GAP-0113: POST /api/auth/settings/idps/:alias/test-connection - runtime route has no semantic contract definition
- USF-GAP-0114: POST /api/auth/settings/idps/oidc/discover - runtime route has no semantic contract definition
- USF-GAP-0115: GET /api/auth/settings/lockout - runtime route has no semantic contract definition
- USF-GAP-0116: PATCH /api/auth/settings/lockout - runtime route has no semantic contract definition
- USF-GAP-0117: GET /api/auth/settings/mfa - runtime route has no semantic contract definition
- USF-GAP-0118: PATCH /api/auth/settings/mfa - runtime route has no semantic contract definition
- USF-GAP-0119: GET /api/auth/settings/providers - runtime route has no semantic contract definition
- USF-GAP-0120: PATCH /api/auth/settings/providers - runtime route has no semantic contract definition
- USF-GAP-0121: GET /api/auth/settings/readiness - runtime route has no semantic contract definition
- USF-GAP-0122: GET /api/auth/settings/resource-policies - runtime route has no semantic contract definition
- USF-GAP-0123: PATCH /api/auth/settings/resource-policies - runtime route has no semantic contract definition
- USF-GAP-0124: GET /api/auth/settings/session - runtime route has no semantic contract definition
- USF-GAP-0125: PATCH /api/auth/settings/session - runtime route has no semantic contract definition
- USF-GAP-0126: GET /api/auth/settings/sysadmin-brokering - runtime route has no semantic contract definition
- USF-GAP-0127: PATCH /api/auth/settings/sysadmin-brokering - runtime route has no semantic contract definition
- USF-GAP-0128: POST /api/graphql - runtime route has no semantic contract definition
- USF-GAP-0129: GET /api/me/notification-preferences - runtime route has no semantic contract definition
- USF-GAP-0130: PATCH /api/me/notification-preferences - runtime route has no semantic contract definition
- USF-GAP-0131: GET /api/me/profile - runtime route has no semantic contract definition
- USF-GAP-0132: PATCH /api/me/profile - runtime route has no semantic contract definition
- USF-GAP-0133: GET /api/org/api-keys - runtime route has no semantic contract definition
- USF-GAP-0134: POST /api/org/api-keys - runtime route has no semantic contract definition
- USF-GAP-0135: DELETE /api/org/api-keys/:keyId - runtime route has no semantic contract definition
- USF-GAP-0136: GET /api/org/config - runtime route has no semantic contract definition
- USF-GAP-0137: DELETE /api/org/config/:key - runtime route has no semantic contract definition
- USF-GAP-0138: PATCH /api/org/config/:key - runtime route has no semantic contract definition
- USF-GAP-0139: GET /api/org/developer - runtime route has no semantic contract definition
- USF-GAP-0140: GET /api/org/domains - runtime route has no semantic contract definition
- USF-GAP-0141: POST /api/org/domains - runtime route has no semantic contract definition
- USF-GAP-0142: DELETE /api/org/domains/:domain - runtime route has no semantic contract definition
- USF-GAP-0143: POST /api/org/domains/:domain/activate - runtime route has no semantic contract definition
- USF-GAP-0144: DELETE /api/org/domains/:domain/canonical - runtime route has no semantic contract definition
- USF-GAP-0145: POST /api/org/domains/:domain/canonical - runtime route has no semantic contract definition
- USF-GAP-0146: POST /api/org/domains/:domain/deactivate - runtime route has no semantic contract definition
- USF-GAP-0147: POST /api/org/domains/:domain/probe-routing-local - runtime route has no semantic contract definition
- USF-GAP-0148: POST /api/org/domains/:domain/verify - runtime route has no semantic contract definition
- USF-GAP-0149: GET /api/org/domains/readiness - runtime route has no semantic contract definition
- USF-GAP-0150: GET /api/org/email-sender - runtime route has no semantic contract definition
- USF-GAP-0151: PATCH /api/org/email-sender - runtime route has no semantic contract definition
- USF-GAP-0152: GET /api/org/email-sender/readiness - runtime route has no semantic contract definition
- USF-GAP-0153: POST /api/org/email-sender/test - runtime route has no semantic contract definition
- USF-GAP-0154: GET /api/org/features - runtime route has no semantic contract definition
- USF-GAP-0155: PATCH /api/org/features/:featureKey - runtime route has no semantic contract definition
- USF-GAP-0156: GET /api/org/groups - runtime route has no semantic contract definition
- USF-GAP-0157: POST /api/org/groups - runtime route has no semantic contract definition
- USF-GAP-0158: DELETE /api/org/groups/:groupId - runtime route has no semantic contract definition
- USF-GAP-0159: PATCH /api/org/groups/:groupId - runtime route has no semantic contract definition
- USF-GAP-0160: GET /api/org/members - runtime route has no semantic contract definition
- USF-GAP-0161: DELETE /api/org/members/:userId - runtime route has no semantic contract definition
- USF-GAP-0162: PATCH /api/org/members/:userId - runtime route has no semantic contract definition
- USF-GAP-0163: GET /api/org/members/:userId/external-identities - runtime route has no semantic contract definition
- USF-GAP-0164: PATCH /api/org/members/:userId/status - runtime route has no semantic contract definition
- USF-GAP-0165: PATCH /api/org/members/:userId/username - runtime route has no semantic contract definition
- USF-GAP-0166: POST /api/org/members/invite - runtime route has no semantic contract definition
- USF-GAP-0167: POST /api/org/members/resend-invite - runtime route has no semantic contract definition
- USF-GAP-0168: GET /api/org/observability/readiness - runtime route has no semantic contract definition
- USF-GAP-0169: GET /api/org/rate-limits - runtime route has no semantic contract definition
- USF-GAP-0170: GET /api/org/readiness - runtime route has no semantic contract definition
- USF-GAP-0171: POST /api/org/search - runtime route has no semantic contract definition
- USF-GAP-0172: GET /api/org/storage/objects - runtime route has no semantic contract definition
- USF-GAP-0173: POST /api/org/storage/objects - runtime route has no semantic contract definition
- USF-GAP-0174: DELETE /api/org/storage/objects/:objectKey - runtime route has no semantic contract definition
- USF-GAP-0175: GET /api/org/storage/objects/:objectKey - runtime route has no semantic contract definition
- USF-GAP-0176: POST /api/org/storage/objects/:objectKey/scan - runtime route has no semantic contract definition
- USF-GAP-0177: POST /api/org/storage/probe - runtime route has no semantic contract definition
- USF-GAP-0178: GET /api/org/storage/readiness - runtime route has no semantic contract definition
- USF-GAP-0179: GET /api/org/sub-organisations - runtime route has no semantic contract definition
- USF-GAP-0180: POST /api/org/sub-organisations - runtime route has no semantic contract definition
- USF-GAP-0181: DELETE /api/org/sub-organisations/:subOrgId - runtime route has no semantic contract definition
- USF-GAP-0182: PATCH /api/org/sub-organisations/:subOrgId - runtime route has no semantic contract definition
- USF-GAP-0183: GET /api/org/webhooks - runtime route has no semantic contract definition
- USF-GAP-0184: POST /api/org/webhooks - runtime route has no semantic contract definition
- USF-GAP-0185: DELETE /api/org/webhooks/:id - runtime route has no semantic contract definition
- USF-GAP-0186: PATCH /api/org/webhooks/:id - runtime route has no semantic contract definition
- USF-GAP-0187: GET /api/org/webhooks/:id/deliveries - runtime route has no semantic contract definition
- USF-GAP-0188: POST /api/org/webhooks/:id/deliveries/:deliveryId/redrive - runtime route has no semantic contract definition
- USF-GAP-0189: GET /api/org/webhooks/:id/metrics - runtime route has no semantic contract definition
- USF-GAP-0190: POST /api/org/webhooks/:id/redrive-dead - runtime route has no semantic contract definition
- USF-GAP-0191: POST /api/org/webhooks/:id/rotate-secret - runtime route has no semantic contract definition
- USF-GAP-0192: POST /api/org/webhooks/:id/test - runtime route has no semantic contract definition
- USF-GAP-0193: GET /api/org/webhooks/readiness - runtime route has no semantic contract definition
- USF-GAP-0194: GET /api/organisation/profile - runtime route has no semantic contract definition
- USF-GAP-0195: PATCH /api/organisation/profile - runtime route has no semantic contract definition
- USF-GAP-0196: GET /api/session - runtime route has no semantic contract definition
- USF-GAP-0197: GET /auth/callback - runtime route has no semantic contract definition
- USF-GAP-0198: GET /auth/login - runtime route has no semantic contract definition
- USF-GAP-0199: POST /auth/logout - runtime route has no semantic contract definition
- USF-GAP-0200: GET /e2e-harness - runtime route has no semantic contract definition
- USF-GAP-0201: GET /healthz - runtime route has no semantic contract definition
- USF-GAP-0202: GET /internal/auth/forward - runtime route has no semantic contract definition
- USF-GAP-0203: GET /login - runtime route has no semantic contract definition
- USF-GAP-0204: GET /organisation/profile - runtime route has no semantic contract definition
- USF-GAP-0205: GET /readyz - runtime route has no semantic contract definition
- USF-GAP-0206: GET /version - runtime route has no semantic contract definition
- USF-GAP-0207: POST /faro/collect - semantic route claim has no runtime route implementation
- USF-GAP-0208: GET / - semantic/runtime route lacks executable proof
- USF-GAP-0209: GET /admin - semantic/runtime route lacks executable proof
- USF-GAP-0210: GET /admin/account - semantic/runtime route lacks executable proof
- USF-GAP-0211: GET /admin/auth - semantic/runtime route lacks executable proof
- USF-GAP-0212: GET /admin/clickthrough - semantic/runtime route lacks executable proof
- USF-GAP-0213: GET /admin/config - semantic/runtime route lacks executable proof
- USF-GAP-0214: GET /admin/developer - semantic/runtime route lacks executable proof
- USF-GAP-0215: GET /admin/domains - semantic/runtime route lacks executable proof
- USF-GAP-0216: GET /admin/email - semantic/runtime route lacks executable proof
- USF-GAP-0217: GET /admin/entitlements - semantic/runtime route lacks executable proof
- USF-GAP-0218: GET /admin/events - semantic/runtime route lacks executable proof
- USF-GAP-0219: GET /admin/features - semantic/runtime route lacks executable proof
- USF-GAP-0220: GET /admin/logs - semantic/runtime route lacks executable proof
- USF-GAP-0221: GET /admin/members - semantic/runtime route lacks executable proof
- USF-GAP-0222: GET /admin/monitoring - semantic/runtime route lacks executable proof
- USF-GAP-0223: GET /admin/observability - semantic/runtime route lacks executable proof
- USF-GAP-0224: GET /admin/platform - semantic/runtime route lacks executable proof
- USF-GAP-0225: GET /admin/readiness - semantic/runtime route lacks executable proof
- USF-GAP-0226: GET /admin/scheduled-jobs - semantic/runtime route lacks executable proof
- USF-GAP-0227: GET /admin/search - semantic/runtime route lacks executable proof
- USF-GAP-0228: GET /admin/storage - semantic/runtime route lacks executable proof
- USF-GAP-0229: GET /admin/usage - semantic/runtime route lacks executable proof
- USF-GAP-0230: GET /admin/webhooks - semantic/runtime route lacks executable proof
- USF-GAP-0231: GET /api/auth/providers - semantic/runtime route lacks executable proof
- USF-GAP-0232: POST /api/graphql - semantic/runtime route lacks executable proof
- USF-GAP-0233: GET /api/organisation/profile - semantic/runtime route lacks executable proof
- USF-GAP-0234: PATCH /api/organisation/profile - semantic/runtime route lacks executable proof
- USF-GAP-0235: GET /api/session - semantic/runtime route lacks executable proof
- USF-GAP-0236: GET /e2e-harness - semantic/runtime route lacks executable proof
- USF-GAP-0237: GET /login - semantic/runtime route lacks executable proof
- USF-GAP-0238: GET /organisation/profile - semantic/runtime route lacks executable proof
- USF-GAP-0239: npm run api:start - runtime command has no semantic catalogue link
- USF-GAP-0240: npm run api:start:admin - runtime command has no semantic catalogue link
- USF-GAP-0241: npm run api:start:viewer - runtime command has no semantic catalogue link
- USF-GAP-0242: npm run audit:deps - runtime command has no semantic catalogue link
- USF-GAP-0243: npm run build:spa - runtime command has no semantic catalogue link
- USF-GAP-0244: npm run codeql:analyze - runtime command has no semantic catalogue link
- USF-GAP-0245: npm run codeql:db - runtime command has no semantic catalogue link
- USF-GAP-0246: npm run codeql:validate - runtime command has no semantic catalogue link
- USF-GAP-0247: npm run compose:cloud - runtime command has no semantic catalogue link
- USF-GAP-0248: npm run compose:down - runtime command has no semantic catalogue link
- USF-GAP-0249: npm run compose:down:volumes - runtime command has no semantic catalogue link
- USF-GAP-0250: npm run compose:external-mocks - runtime command has no semantic catalogue link
