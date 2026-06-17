# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=b95552eb-80c1-4974-bc97-63544a9b3ba2)
- Root-cause proven: 2 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=5abe60a757294bc775c7d8f02429560d).
