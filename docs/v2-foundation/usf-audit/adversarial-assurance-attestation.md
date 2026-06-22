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
| mutations without audit         |     4 |
| capabilities without ownership  |     0 |
| semantic orphans                |     7 |
| runtime orphans                 |     7 |
| provider reliability gaps       |     0 |
| workflow proof gaps             |     0 |
| storage proof gaps              |     0 |
| event runtime gaps              |     2 |
| false-positive items            |     0 |
| external-limited items          |     0 |
| duplicate findings              |     0 |
| obsolete-runtime-artifact items |     0 |
| must-fix-in-v1 items            |   945 |

## Known Gaps Identified

- USF-GAP-0001: GET / - runtime route has no semantic contract definition
- USF-GAP-0002: POST /faro/collect - semantic route claim has no runtime route implementation
- USF-GAP-0003: GET / - semantic/runtime route lacks executable proof
- USF-GAP-0004: GET /admin - semantic/runtime route lacks executable proof
- USF-GAP-0005: GET /admin/account - semantic/runtime route lacks executable proof
- USF-GAP-0006: GET /admin/auth - semantic/runtime route lacks executable proof
- USF-GAP-0007: GET /admin/clickthrough - semantic/runtime route lacks executable proof
- USF-GAP-0008: GET /admin/config - semantic/runtime route lacks executable proof
- USF-GAP-0009: GET /admin/developer - semantic/runtime route lacks executable proof
- USF-GAP-0010: GET /admin/domains - semantic/runtime route lacks executable proof
- USF-GAP-0011: GET /admin/email - semantic/runtime route lacks executable proof
- USF-GAP-0012: GET /admin/entitlements - semantic/runtime route lacks executable proof
- USF-GAP-0013: GET /admin/events - semantic/runtime route lacks executable proof
- USF-GAP-0014: GET /admin/features - semantic/runtime route lacks executable proof
- USF-GAP-0015: GET /admin/logs - semantic/runtime route lacks executable proof
- USF-GAP-0016: GET /admin/members - semantic/runtime route lacks executable proof
- USF-GAP-0017: GET /admin/monitoring - semantic/runtime route lacks executable proof
- USF-GAP-0018: GET /admin/observability - semantic/runtime route lacks executable proof
- USF-GAP-0019: GET /admin/platform - semantic/runtime route lacks executable proof
- USF-GAP-0020: GET /admin/readiness - semantic/runtime route lacks executable proof
- USF-GAP-0021: GET /admin/scheduled-jobs - semantic/runtime route lacks executable proof
- USF-GAP-0022: GET /admin/search - semantic/runtime route lacks executable proof
- USF-GAP-0023: GET /admin/storage - semantic/runtime route lacks executable proof
- USF-GAP-0024: GET /admin/usage - semantic/runtime route lacks executable proof
- USF-GAP-0025: GET /admin/webhooks - semantic/runtime route lacks executable proof
- USF-GAP-0026: GET /api/auth/providers - semantic/runtime route lacks executable proof
- USF-GAP-0027: GET /api/session - semantic/runtime route lacks executable proof
- USF-GAP-0028: GET /e2e-harness - semantic/runtime route lacks executable proof
- USF-GAP-0029: GET /login - semantic/runtime route lacks executable proof
- USF-GAP-0030: GET /organisation/profile - semantic/runtime route lacks executable proof
- USF-GAP-0031: npm run api:start - runtime command has no semantic catalogue link
- USF-GAP-0032: npm run api:start:admin - runtime command has no semantic catalogue link
- USF-GAP-0033: npm run api:start:viewer - runtime command has no semantic catalogue link
- USF-GAP-0034: npm run audit:deps - runtime command has no semantic catalogue link
- USF-GAP-0035: npm run build:spa - runtime command has no semantic catalogue link
- USF-GAP-0036: npm run codeql:analyze - runtime command has no semantic catalogue link
- USF-GAP-0037: npm run codeql:db - runtime command has no semantic catalogue link
- USF-GAP-0038: npm run codeql:validate - runtime command has no semantic catalogue link
- USF-GAP-0039: npm run compose:cloud - runtime command has no semantic catalogue link
- USF-GAP-0040: npm run compose:down - runtime command has no semantic catalogue link
- USF-GAP-0041: npm run compose:down:volumes - runtime command has no semantic catalogue link
- USF-GAP-0042: npm run compose:external-mocks - runtime command has no semantic catalogue link
- USF-GAP-0043: npm run compose:identity - runtime command has no semantic catalogue link
- USF-GAP-0044: npm run compose:logs - runtime command has no semantic catalogue link
- USF-GAP-0045: npm run compose:ps - runtime command has no semantic catalogue link
- USF-GAP-0046: npm run compose:sentry - runtime command has no semantic catalogue link
- USF-GAP-0047: npm run compose:up - runtime command has no semantic catalogue link
- USF-GAP-0048: npm run compose:up:default - runtime command has no semantic catalogue link
- USF-GAP-0049: npm run coverage:normalize - runtime command has no semantic catalogue link
- USF-GAP-0050: npm run db:reset - runtime command has no semantic catalogue link
- USF-GAP-0051: npm run e2e:accessibility - runtime command has no semantic catalogue link
- USF-GAP-0052: npm run e2e:coverage:validate - runtime command has no semantic catalogue link
- USF-GAP-0053: npm run e2e:failure:rootcause - runtime command has no semantic catalogue link
- USF-GAP-0054: npm run e2e:observability:correlate - runtime command has no semantic catalogue link
- USF-GAP-0055: npm run e2e:persona:authz - runtime command has no semantic catalogue link
- USF-GAP-0056: npm run e2e:personas:validate - runtime command has no semantic catalogue link
- USF-GAP-0057: npm run e2e:registry:validate - runtime command has no semantic catalogue link
- USF-GAP-0058: npm run e2e:scenario:validate - runtime command has no semantic catalogue link
- USF-GAP-0059: npm run e2e:sentry:assert - runtime command has no semantic catalogue link
- USF-GAP-0060: npm run e2e:ui:contract:validate - runtime command has no semantic catalogue link
- USF-GAP-0061: npm run e2e:ui:discover - runtime command has no semantic catalogue link
- USF-GAP-0062: npm run format:check - runtime command has no semantic catalogue link
- USF-GAP-0063: npm run format:write - runtime command has no semantic catalogue link
- USF-GAP-0064: npm run frontend:conventions - runtime command has no semantic catalogue link
- USF-GAP-0065: npm run generate:feature - runtime command has no semantic catalogue link
- USF-GAP-0066: npm run license:policy - runtime command has no semantic catalogue link
- USF-GAP-0067: npm run lint:md - runtime command has no semantic catalogue link
- USF-GAP-0068: npm run mcp:governor - runtime command has no semantic catalogue link
- USF-GAP-0069: npm run mcp:governor:selftest - runtime command has no semantic catalogue link
- USF-GAP-0070: npm run proof:alert-incident-closure - runtime command has no semantic catalogue link
- USF-GAP-0071: npm run proof:approval-workflow - runtime command has no semantic catalogue link
- USF-GAP-0072: npm run proof:auth-credential-lifecycle - runtime command has no semantic catalogue link
- USF-GAP-0073: npm run proof:backup-control-route - runtime command has no semantic catalogue link
- USF-GAP-0074: npm run proof:billing-control-route - runtime command has no semantic catalogue link
- USF-GAP-0075: npm run proof:billing-readiness-route - runtime command has no semantic catalogue link
- USF-GAP-0076: npm run proof:composed-provider-runtime-closure - runtime command has no semantic catalogue link
- USF-GAP-0077: npm run proof:email-sender - runtime command has no semantic catalogue link
- USF-GAP-0078: npm run proof:full-observability-contract - runtime command has no semantic catalogue link
- USF-GAP-0079: npm run proof:http-engine-providers - runtime command has no semantic catalogue link
- USF-GAP-0080: npm run proof:observability-control-route - runtime command has no semantic catalogue link
- USF-GAP-0081: npm run proof:observability-metrics-traces-closure - runtime command has no semantic catalogue link
- USF-GAP-0082: npm run proof:observability-provider-closure - runtime command has no semantic catalogue link
- USF-GAP-0083: npm run proof:observability-readiness-route - runtime command has no semantic catalogue link
- USF-GAP-0084: npm run proof:provider-binding-report-route - runtime command has no semantic catalogue link
- USF-GAP-0085: npm run proof:provider-observability-closure - runtime command has no semantic catalogue link
- USF-GAP-0086: npm run proof:provider-observability-contract - runtime command has no semantic catalogue link
- USF-GAP-0087: npm run proof:security-control-route - runtime command has no semantic catalogue link
- USF-GAP-0088: npm run proof:typed-secret-resolution - runtime command has no semantic catalogue link
- USF-GAP-0089: npm run proof:webhook-worker - runtime command has no semantic catalogue link
- USF-GAP-0090: npm run proof:workflow-adapters - runtime command has no semantic catalogue link
- USF-GAP-0091: npm run proof:workflow-closure - runtime command has no semantic catalogue link
- USF-GAP-0092: npm run proof:workflow-control-route - runtime command has no semantic catalogue link
- USF-GAP-0093: npm run proof:workflow-engine - runtime command has no semantic catalogue link
- USF-GAP-0094: npm run proof:workflow-readiness-route - runtime command has no semantic catalogue link
- USF-GAP-0095: npm run sbom:generate - runtime command has no semantic catalogue link
- USF-GAP-0096: npm run sbom:policy - runtime command has no semantic catalogue link
- USF-GAP-0097: npm run sbom:verify - runtime command has no semantic catalogue link
- USF-GAP-0098: npm run secrets:scan - runtime command has no semantic catalogue link
- USF-GAP-0099: npm run seed:idps - runtime command has no semantic catalogue link
- USF-GAP-0100: npm run semgrep:json - runtime command has no semantic catalogue link
- USF-GAP-0101: npm run test:e2e:build - runtime command has no semantic catalogue link
- USF-GAP-0102: npm run test:e2e:external - runtime command has no semantic catalogue link
- USF-GAP-0103: npm run test:e2e:internal - runtime command has no semantic catalogue link
- USF-GAP-0104: npm run test:e2e:report - runtime command has no semantic catalogue link
- USF-GAP-0105: npm run test:e2e:ui - runtime command has no semantic catalogue link
- USF-GAP-0106: npm run test:mock-oidc - runtime command has no semantic catalogue link
- USF-GAP-0107: npm run test:platform-api:unit-safe - runtime command has no semantic catalogue link
- USF-GAP-0108: npm run test:security - runtime command has no semantic catalogue link
- USF-GAP-0109: npm run tsc:check - runtime command has no semantic catalogue link
- USF-GAP-0110: npm run tsc:check:api - runtime command has no semantic catalogue link
- USF-GAP-0111: npm run tsc:check:packages - runtime command has no semantic catalogue link
- USF-GAP-0112: npm run ui:harness - runtime command has no semantic catalogue link
- USF-GAP-0113: npm run ui:harness:e2e - runtime command has no semantic catalogue link
- USF-GAP-0114: npm run ui:harness:test - runtime command has no semantic catalogue link
- USF-GAP-0115: npm run usf:render - runtime command has no semantic catalogue link
- USF-GAP-0116: npm run v2:adversarial-usf-audit - runtime command has no semantic catalogue link
- USF-GAP-0117: npm run v2:formal-assurance - runtime command has no semantic catalogue link
- USF-GAP-0118: npm run v2:readiness:json - runtime command has no semantic catalogue link
- USF-GAP-0119: npm run v2:usf-assurance - runtime command has no semantic catalogue link
- USF-GAP-0120: npm run validate:slices - runtime command has no semantic catalogue link
- USF-GAP-0121: retention-tick - runtime worker has no semantic worker/event link
- USF-GAP-0122: clamav-antivirus - runtime provider has no semantic/provider matrix link
- USF-GAP-0123: http-engine-provider - runtime provider has no semantic/provider matrix link
- USF-GAP-0124: in-memory-automation-runner - runtime provider has no semantic/provider matrix link
- USF-GAP-0125: in-memory-billing-provider - runtime provider has no semantic/provider matrix link
- USF-GAP-0126: postgres-email-sender-store - runtime provider has no semantic/provider matrix link
- USF-GAP-0127: postgres-legal-hold - runtime provider has no semantic/provider matrix link
- USF-GAP-0128: postgres-rate-limit-repository - runtime provider has no semantic/provider matrix link
- USF-GAP-0129: postgres-tenant-credential-store - runtime provider has no semantic/provider matrix link
- USF-GAP-0130: smtp-email-adapter - runtime provider has no semantic/provider matrix link
- USF-GAP-0131: tenant-secret-crypto - runtime provider has no semantic/provider matrix link
- USF-GAP-0132: clamav-antivirus - runtime storage operation has no semantic storage link
- USF-GAP-0133: postgres-legal-hold - runtime storage operation has no semantic storage link
- USF-GAP-0134: adapters-object-storage.test - runtime storage operation has no semantic storage link
- USF-GAP-0135: storage-runtime.test - runtime storage operation has no semantic storage link
- USF-GAP-0136: workflow-control - runtime workflow has no semantic workflow/state-machine link
- USF-GAP-0137: workflow-readiness - runtime workflow has no semantic workflow/state-machine link
- USF-GAP-0138: in-memory-automation-runner - runtime workflow has no semantic workflow/state-machine link
- USF-GAP-0139: POST /api/auth/settings/idps/oidc/discover - runtime audit requirement has no audit event mapping
- USF-GAP-0140: POST /api/graphql - runtime audit requirement has no audit event mapping
- USF-GAP-0141: POST /api/org/search - runtime audit requirement has no audit event mapping
- USF-GAP-0142: POST /auth/logout - runtime audit requirement has no audit event mapping
- USF-GAP-0143: GET / - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0144: GET /admin - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0145: GET /admin/account - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0146: GET /admin/auth - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0147: GET /admin/clickthrough - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0148: GET /admin/config - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0149: GET /admin/developer - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0150: GET /admin/domains - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0151: GET /admin/email - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0152: GET /admin/entitlements - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0153: GET /admin/events - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0154: GET /admin/features - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0155: GET /admin/logs - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0156: GET /admin/members - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0157: GET /admin/monitoring - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0158: GET /admin/observability - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0159: GET /admin/platform - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0160: GET /admin/readiness - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0161: GET /admin/scheduled-jobs - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0162: GET /admin/search - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0163: GET /admin/storage - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0164: GET /admin/usage - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0165: GET /admin/webhooks - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0166: GET /api/auth/providers - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0167: GET /api/session - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0168: GET /e2e-harness - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0169: GET /login - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0170: GET /organisation/profile - runtime observability surface lacks trace/log/metric mapping
- USF-GAP-0171: GET / - route without trace span
- USF-GAP-0172: GET / - route without structured complete/error logs
- USF-GAP-0173: GET / - route without metric
- USF-GAP-0174: GET / - route without correlation id evidence
- USF-GAP-0175: GET / - route without executable proof reference
- USF-GAP-0176: GET /admin - route without trace span
- USF-GAP-0177: GET /admin - route without structured complete/error logs
- USF-GAP-0178: GET /admin - route without metric
- USF-GAP-0179: GET /admin - route without correlation id evidence
- USF-GAP-0180: GET /admin - route without executable proof reference
- USF-GAP-0181: GET /admin/account - route without trace span
- USF-GAP-0182: GET /admin/account - route without structured complete/error logs
- USF-GAP-0183: GET /admin/account - route without metric
- USF-GAP-0184: GET /admin/account - route without correlation id evidence
- USF-GAP-0185: GET /admin/account - route without executable proof reference
- USF-GAP-0186: GET /admin/auth - route without trace span
- USF-GAP-0187: GET /admin/auth - route without structured complete/error logs
- USF-GAP-0188: GET /admin/auth - route without metric
- USF-GAP-0189: GET /admin/auth - route without correlation id evidence
- USF-GAP-0190: GET /admin/auth - route without executable proof reference
- USF-GAP-0191: GET /admin/clickthrough - route without trace span
- USF-GAP-0192: GET /admin/clickthrough - route without structured complete/error logs
- USF-GAP-0193: GET /admin/clickthrough - route without metric
- USF-GAP-0194: GET /admin/clickthrough - route without correlation id evidence
- USF-GAP-0195: GET /admin/clickthrough - route without executable proof reference
- USF-GAP-0196: GET /admin/config - route without trace span
- USF-GAP-0197: GET /admin/config - route without structured complete/error logs
- USF-GAP-0198: GET /admin/config - route without metric
- USF-GAP-0199: GET /admin/config - route without correlation id evidence
- USF-GAP-0200: GET /admin/config - route without executable proof reference
- USF-GAP-0201: GET /admin/developer - route without trace span
- USF-GAP-0202: GET /admin/developer - route without structured complete/error logs
- USF-GAP-0203: GET /admin/developer - route without metric
- USF-GAP-0204: GET /admin/developer - route without correlation id evidence
- USF-GAP-0205: GET /admin/developer - route without executable proof reference
- USF-GAP-0206: GET /admin/domains - route without trace span
- USF-GAP-0207: GET /admin/domains - route without structured complete/error logs
- USF-GAP-0208: GET /admin/domains - route without metric
- USF-GAP-0209: GET /admin/domains - route without correlation id evidence
- USF-GAP-0210: GET /admin/domains - route without executable proof reference
- USF-GAP-0211: GET /admin/email - route without trace span
- USF-GAP-0212: GET /admin/email - route without structured complete/error logs
- USF-GAP-0213: GET /admin/email - route without metric
- USF-GAP-0214: GET /admin/email - route without correlation id evidence
- USF-GAP-0215: GET /admin/email - route without executable proof reference
- USF-GAP-0216: GET /admin/entitlements - route without trace span
- USF-GAP-0217: GET /admin/entitlements - route without structured complete/error logs
- USF-GAP-0218: GET /admin/entitlements - route without metric
- USF-GAP-0219: GET /admin/entitlements - route without correlation id evidence
- USF-GAP-0220: GET /admin/entitlements - route without executable proof reference
- USF-GAP-0221: GET /admin/events - route without trace span
- USF-GAP-0222: GET /admin/events - route without structured complete/error logs
- USF-GAP-0223: GET /admin/events - route without metric
- USF-GAP-0224: GET /admin/events - route without correlation id evidence
- USF-GAP-0225: GET /admin/events - route without executable proof reference
- USF-GAP-0226: GET /admin/features - route without trace span
- USF-GAP-0227: GET /admin/features - route without structured complete/error logs
- USF-GAP-0228: GET /admin/features - route without metric
- USF-GAP-0229: GET /admin/features - route without correlation id evidence
- USF-GAP-0230: GET /admin/features - route without executable proof reference
- USF-GAP-0231: GET /admin/logs - route without trace span
- USF-GAP-0232: GET /admin/logs - route without structured complete/error logs
- USF-GAP-0233: GET /admin/logs - route without metric
- USF-GAP-0234: GET /admin/logs - route without correlation id evidence
- USF-GAP-0235: GET /admin/logs - route without executable proof reference
- USF-GAP-0236: GET /admin/members - route without trace span
- USF-GAP-0237: GET /admin/members - route without structured complete/error logs
- USF-GAP-0238: GET /admin/members - route without metric
- USF-GAP-0239: GET /admin/members - route without correlation id evidence
- USF-GAP-0240: GET /admin/members - route without executable proof reference
- USF-GAP-0241: GET /admin/monitoring - route without trace span
- USF-GAP-0242: GET /admin/monitoring - route without structured complete/error logs
- USF-GAP-0243: GET /admin/monitoring - route without metric
- USF-GAP-0244: GET /admin/monitoring - route without correlation id evidence
- USF-GAP-0245: GET /admin/monitoring - route without executable proof reference
- USF-GAP-0246: GET /admin/observability - route without trace span
- USF-GAP-0247: GET /admin/observability - route without structured complete/error logs
- USF-GAP-0248: GET /admin/observability - route without metric
- USF-GAP-0249: GET /admin/observability - route without correlation id evidence
- USF-GAP-0250: GET /admin/observability - route without executable proof reference
