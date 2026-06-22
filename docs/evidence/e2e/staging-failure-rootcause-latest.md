# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=0b977984-e3eb-43e6-abe1-56263b5f942b)
- Root-cause proven: 21 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=static_permission_denied, traceId=528e5905372aa2ecce1cb157fd0a2008).
