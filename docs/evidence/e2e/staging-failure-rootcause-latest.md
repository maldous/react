# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=0bdf89d6-98da-461f-8f38-c3bdecd590f3)
- Root-cause proven: 21 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=8af57d0edfd9549aa8dc11fb9eba9fd3).
