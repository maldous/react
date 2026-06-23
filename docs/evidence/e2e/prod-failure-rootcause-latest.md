# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=d30ceed6-e818-4922-892c-7d74190c3e3e)
- Root-cause proven: 35 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=95691925fc5b2ef6789ab023963dda25).
