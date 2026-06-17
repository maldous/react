# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=e029e025-4170-4a76-b64b-89824ccd081f)
- Root-cause proven: 1 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=5c743c69ff0b5dfbc4dd70cfa522a93d).
