# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=362b3333-62e9-4356-bb39-6fa29219714d)
- Root-cause proven: 18 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=27af743f456d70b36dc2941e83f52556).
