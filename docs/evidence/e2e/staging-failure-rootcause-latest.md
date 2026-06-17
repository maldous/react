# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=5faa1c2d-21e7-4b78-a52e-d2270b7d4bbc)
- Root-cause proven: 1 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=60f82789e7e73a319080922f3aafde9b).
