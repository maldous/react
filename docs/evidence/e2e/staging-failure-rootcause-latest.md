# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=e9a25ab1-49b0-47ff-8258-631d1bc592eb)
- Root-cause proven: 20 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=2f37fa4e8e1acf44ce6f00def61e756c).
