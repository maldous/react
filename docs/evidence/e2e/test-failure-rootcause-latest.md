# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=d59f150d-73ca-40bf-bc8f-ce8d7a428aba)
- Root-cause proven: 47 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=1d08b8b4a3786f277843b38c266637fa).
