# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=c4d94770-736c-466a-bf0e-7d50bbc679af)
- Root-cause proven: 1 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=f85a0336dbbb187adfa8f388c2b75c2b).
