# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=fffb0edf-d78f-43f6-b4ee-80f7d5e546ab)
- Root-cause proven: 19 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=ecc228f13457a30036a5afdc98b3a334).
