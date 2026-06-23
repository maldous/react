# E2E failure-rootcause — staging

Generated (ADR-ACT-0285 Phase 5). DO NOT EDIT — regenerate via make e2e-failure-rootcause.

- Result: **PASSED**
- Triggered unauthenticated /api/admin/tenants → HTTP 401 (x-request-id=413303f4-8790-44bb-80f9-053da511312c)
- Root-cause proven: 35 http.request.rejected line(s) in Loki carry a stable reason + requestId (sample reason=static_permission_denied, traceId=043dc8ce076a1783217030443302a42a).
