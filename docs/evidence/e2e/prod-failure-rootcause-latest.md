# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=2307055c-b614-4738-a4ca-753adcf67bba)
- Root-cause proven: 21 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=0d6fb2cf97ecf85600428b352cc1df76).
