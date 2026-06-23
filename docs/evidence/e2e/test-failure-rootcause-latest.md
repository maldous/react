# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=899d6e47-db3e-4939-aa10-f465f263b0bc)
- Root-cause proven: 47 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=0520843c9c89b4cf0796593c381e4746).
