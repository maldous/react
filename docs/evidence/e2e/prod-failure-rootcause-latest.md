# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=38046517-a664-419a-a141-c33a7ec13a43)
- Root-cause proven: 4 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=tenant_fqdn_required, traceId=7af8eaec8a5d78e193df19239f9c5411).
