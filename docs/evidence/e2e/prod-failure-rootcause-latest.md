# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=ca20a381-13cc-4e76-be06-93444c65442a)
- Root-cause proven: 2 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=af5c6215fa2c3342599b8c1901b62744).
