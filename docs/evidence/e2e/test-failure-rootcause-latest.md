# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=7e88eee8-c7c0-47d5-835c-8f43c1d03c64)
- Root-cause proven: 19 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=105a27bd0776ee742571366427580a0a).
