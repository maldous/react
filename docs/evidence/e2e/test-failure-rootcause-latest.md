# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=ec154054-9b14-4f8c-9259-1ce18e94d830)
- Root-cause proven: 1 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=266f31e24e67eda26791101f4d5e02c9).
