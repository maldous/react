# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=e27d2800-c2a8-4dee-9fbd-64eb5c37236e)
- Root-cause proven: 4 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=tenant_fqdn_required, traceId=70b2db4b1a8823eb2bcfb7098194ad7b).
