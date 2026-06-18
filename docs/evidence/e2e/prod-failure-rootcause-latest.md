# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=4005c241-9483-432b-9aea-3573111bdb02)
- Root-cause proven: 21 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=static_permission_denied, traceId=a905a84086719df4c53dd1d4903c69a6).
