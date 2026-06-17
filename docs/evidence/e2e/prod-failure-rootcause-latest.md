# E2E failure-rootcause — prod

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=a340eddc-9295-4dad-93f4-534aedb2248d)
- Root-cause proven: 1 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=authentication_required, traceId=b353ee95a22b712103ff8625de1518ff).
