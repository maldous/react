# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=e201c8ee-71fa-4f33-ac37-5b26171940dd)
- Root-cause proven: 19 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=b0b59ae3dc28c14924a6e69052f0bf54).
