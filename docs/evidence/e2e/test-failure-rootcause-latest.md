# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=325b8602-2783-430c-917a-f6d588d072b0)
- Root-cause proven: 47 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=1dd81653d08ccf15958570b1af3d57d4).
