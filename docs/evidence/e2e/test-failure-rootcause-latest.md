# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=9492c347-e109-4a07-8cfb-560bfead967a)
- Root-cause proven: 47 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=2d40b42525f199c4a572f55b0276f105).
