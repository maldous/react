# E2E failure-rootcause — test

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=37922e93-3bf5-445c-aec0-af57b3741263)
- Root-cause proven: 19 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=76c2b7b7fc6848f71d65c52fdaa3e477).
