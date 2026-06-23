# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=b4030e2d-e3da-41db-881b-7e2538fe854d)
- Root-cause proven: 35 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=18a172e51075a518599628a23a4c54e7).
