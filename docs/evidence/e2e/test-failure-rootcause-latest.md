# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=75d8d7a5-2eeb-4d9d-8cc2-0754479489c2)
- Root-cause proven: 47 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=099825f60956b4f27a5f60f5261071bc).
