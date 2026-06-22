# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=c6de1914-ec9a-4aea-b89c-713009a30132)
- Root-cause proven: 19 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=a8c8e0a8499bae912d0bdd985205b66d).
