# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=e7c365d0-4991-475a-942c-032c5dfa7faf)
- Root-cause proven: 35 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=static_permission_denied, traceId=5aa8df097f97464a1d44d0709bccc9f2).
